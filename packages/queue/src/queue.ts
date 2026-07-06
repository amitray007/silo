/**
 * pg-boss queue: name + job/queue options shared by BOTH the send side (in
 * `@silo/core`'s `createLink` — see `packages/core/src/links/enqueue.ts`) and
 * the work side (`@silo/worker`'s `worker.ts`), plus the shared PgBoss
 * factory used by ANY process that needs to talk to the `enrich-link` queue —
 * whether it only sends (the API, a producer) or both sends and works
 * (the worker, or the `@silo/app` turnkey process that runs both roles
 * in-process).
 *
 * Split rationale (plan U5 note, updated plan 013): `createLink` must enqueue
 * transactionally, but `@silo/core` must never depend on `@silo/worker` or
 * `@silo/api` (architecture.md — the dependency only runs adapter -> core,
 * never core -> adapter, and adapters never depend on each other). Both the
 * worker (which consumes) and the API (which produces, once it registers the
 * enqueuer at startup — see `packages/api/src/main.ts`) need the exact same
 * queue name, job options, and connection factory, so those live here, in a
 * shared library package that both may import.
 *
 * `@silo/queue` is a shared LIBRARY (like `@silo/db` is for data access), not
 * an adapter: it has no HTTP/MCP/CLI surface of its own, and dependency
 * direction stays adapter/worker -> queue -> core, never the reverse.
 *
 * pg-boss owns its own `pgboss` schema and gets its OWN connection/pool,
 * separate from `@silo/db`'s app pool (plan KTD) — its polling/maintenance
 * queries must never contend with the app's query pool.
 */

import { ENRICH_LINK_QUEUE as CORE_ENRICH_LINK_QUEUE, setEnrichmentEnqueuer } from '@silo/core';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';

/** The one enrichment queue this slice uses. */
export const ENRICH_LINK_QUEUE = 'enrich-link';

/** Where a job lands after exhausting `retryLimit` on the main queue. */
export const ENRICH_LINK_DLQ = 'enrich-link-dlq';

/**
 * Queue-level job options (plan U5): inherited by every job sent to the
 * queue unless overridden per-send. `expireInSeconds` bounds how long a job
 * may sit `active` before pg-boss reclaims it as failed/retried — a stuck
 * worker (crash, hang) can never wedge a job `active` forever.
 */
export const ENRICH_LINK_QUEUE_OPTIONS = {
  // `stately` + singletonKey=linkId is what actually enforces plan R2 ("a
  // re-save never stacks a duplicate job"). A bare singletonKey on the default
  // `standard` policy does NOT dedup — pg-boss v12 only dedups by singletonKey
  // under a policy that constrains per-state counts. `stately` allows at most
  // one job PER STATE (one queued AND one active) per singletonKey, so a
  // re-save while an enrichment is queued-or-running won't add a second.
  policy: 'stately',
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 120,
  deadLetter: ENRICH_LINK_DLQ,
} as const;

/**
 * Build a PgBoss instance for the `enrich-link` queue. Any process that needs
 * to send and/or work this queue calls this — the standalone `@silo/worker`
 * process (send + work), the `@silo/api` process (send only, the producer),
 * and the `@silo/app` turnkey process (both, in-process). Reads its
 * connection string from `WORKER_DATABASE_URL`, falling back to
 * `DATABASE_URL` so a single-database local/dev setup doesn't need a second
 * env var; production deployments should set `WORKER_DATABASE_URL` to route
 * pg-boss's own pool away from the app pool's connection budget.
 */
export function createBoss(): PgBoss {
  const connectionString = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'createBoss: WORKER_DATABASE_URL (or DATABASE_URL) must be set to connect pg-boss.',
    );
  }
  return new PgBoss({
    connectionString,
    schema: 'pgboss',
    max: 5,
    application_name: 'silo-queue',
  });
}

/**
 * Ensure both the main queue and its dead-letter queue exist. Idempotent —
 * `createQueue` is a no-op if the queue already exists with the same
 * definition. Must run before any `send`/`work` against the queue (pg-boss
 * v12 requires `createQueue` up front; sending to an undeclared queue
 * errors).
 */
export async function ensureEnrichLinkQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(ENRICH_LINK_DLQ);
  await boss.createQueue(ENRICH_LINK_QUEUE, ENRICH_LINK_QUEUE_OPTIONS);
}

/**
 * Log how many jobs sit in the dead-letter queue (enrichments that exhausted
 * their retries — each is a link stranded at `enriching`). Without this the DLQ
 * is a black hole: a sustained DB blip could strand many links invisibly. This
 * makes the count observable at startup; a real alerting hook is deferred (see
 * the plan's deferred list). Best-effort — a failure to read the count must
 * never stop the caller from starting.
 */
export async function logDlqDepth(boss: PgBoss): Promise<void> {
  try {
    // getQueueStats returns a snapshot array; with persistQueueStats off it's a
    // single fresh reading. `totalCount` is the pending job count for the queue.
    const [stats] = await boss.getQueueStats(ENRICH_LINK_DLQ);
    const size = stats?.totalCount ?? 0;
    if (size > 0) {
      console.warn(
        `[silo/queue] ${size} job(s) in ${ENRICH_LINK_DLQ} — links stranded at 'enriching' after exhausting retries. Investigate.`,
      );
    } else {
      console.log(`[silo/queue] ${ENRICH_LINK_DLQ} is empty.`);
    }
  } catch (error) {
    console.error('[silo/queue] could not read DLQ depth:', error);
  }
}

// The core queue name must match the one the worker consumes — assert at
// module load rather than trusting two hand-kept literals to stay in sync.
if (ENRICH_LINK_QUEUE !== CORE_ENRICH_LINK_QUEUE) {
  throw new Error(
    `enrich-link queue name drift: queue="${ENRICH_LINK_QUEUE}" core="${CORE_ENRICH_LINK_QUEUE}"`,
  );
}

/**
 * Register the REAL enrichment enqueuer into `@silo/core` (plan R1/R2, U5;
 * plan 013). `createLink` enqueues through core's injectable seam (a no-op by
 * default); this wires that seam to a `fromDrizzle`-based `send()` on the
 * STARTED `boss`, so the job INSERT rides `createLink`'s own transaction
 * (`options.db`) and commits atomically with the link row. `singletonKey =
 * linkId` dedups re-saves (plan R2). Call once, after `boss.start()` (the
 * boss must be open for `send()`'s queue-metadata lookup).
 *
 * Dependency direction stays correct: the caller (worker OR api) imports
 * core and injects into it (`setEnrichmentEnqueuer`); core never imports
 * either.
 */
export function registerEnqueuer(boss: PgBoss): void {
  setEnrichmentEnqueuer(async (exec, linkId) => {
    await boss.send(
      ENRICH_LINK_QUEUE,
      { linkId },
      {
        ...ENRICH_LINK_QUEUE_OPTIONS,
        singletonKey: linkId,
        db: fromDrizzle(exec, sql),
      },
    );
  });
}
