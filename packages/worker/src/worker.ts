/**
 * The `@silo/worker` long-lived entrypoint (plan R13, U5): starts pg-boss on
 * its own connection/pool, ensures the `enrich-link` (+ dead-letter) queue
 * exists, registers the batch-of-one handler that runs `enrichLink`, and
 * stops gracefully on SIGTERM/SIGINT so an in-flight job is allowed to
 * finish rather than being killed mid-write.
 *
 * pg-boss v12 array-handler footgun (plan Risks): `boss.work()` ALWAYS
 * delivers an array of jobs to the handler, even with `batchSize: 1` — a
 * naive `async (job) => ...` handler would silently receive `[job]` and
 * misprocess it (e.g. `job.data.linkId` would be `undefined`). This handler
 * destructures `([job]) => ...` to make the v12 contract explicit.
 */

import { enrichLink } from './enrich.js';
import {
  createWorkerBoss,
  ENRICH_LINK_QUEUE,
  ensureEnrichLinkQueue,
  logDlqDepth,
  registerEnqueuer,
} from './queue.js';

/** Local per-node worker slots (plan: "the worker" — not yet horizontally tuned). */
const LOCAL_CONCURRENCY = 5;

export interface RunWorkerResult {
  /** Stops the worker gracefully, waiting for any in-flight job (bounded by pg-boss's own timeout). */
  stop: () => Promise<void>;
}

/**
 * Start the worker: connect pg-boss, ensure the queue exists, and register
 * the `enrich-link` handler. Returns a `stop()` for graceful shutdown —
 * factored out from the `main()` process wiring below so tests can start/
 * stop a worker instance directly without touching `process` signal
 * handlers.
 */
export async function runWorker(): Promise<RunWorkerResult> {
  const boss = createWorkerBoss();

  boss.on('error', (error) => {
    // pg-boss's own internal errors (maintenance queries, connection issues)
    // surface here — log rather than let them become an unhandled 'error'
    // event, which would crash the process (EventEmitter default behavior).
    console.error('pg-boss error:', error);
  });

  await boss.start();
  await ensureEnrichLinkQueue(boss);

  // Surface any dead-lettered enrichments (stranded links) at startup — the DLQ
  // is otherwise a black hole (see logDlqDepth).
  await logDlqDepth(boss);

  // Wire core's createLink enqueue seam to this started boss, so links created
  // in THIS process (or any process that imported and registered) enqueue
  // transactionally. (The API process, when it exists, registers the same way.)
  registerEnqueuer(boss);

  await boss.work<{ linkId: string }>(
    ENRICH_LINK_QUEUE,
    { batchSize: 1, localConcurrency: LOCAL_CONCURRENCY },
    async ([job]) => {
      // pg-boss guarantees at least one job per invocation with batchSize:1;
      // `noUncheckedIndexedAccess` still types `job` as possibly undefined —
      // handled defensively rather than asserted away.
      if (!job) {
        return;
      }
      await enrichLink(job.data.linkId);
    },
  );

  return {
    stop: () => boss.stop({ graceful: true }),
  };
}

/**
 * Process entrypoint: run the worker and wire SIGTERM/SIGINT to a graceful
 * stop. Guarded so importing this module (e.g. from a test) never has the
 * side effect of starting a real worker — only running it directly
 * (`node worker.js` / `tsx worker.ts`) does.
 */
async function main(): Promise<void> {
  const { stop } = await runWorker();
  console.log(`silo worker: listening on queue "${ENRICH_LINK_QUEUE}"`);

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`silo worker: received ${signal}, stopping gracefully...`);
    stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('silo worker: error during graceful stop:', error);
        process.exit(1);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('silo worker: fatal startup error:', error);
    process.exit(1);
  });
}
