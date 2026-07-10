import { serve } from '@hono/node-server';
import { createApp } from '@silo/api';
import { startWorker, type WorkerHandle } from '@silo/worker';

/**
 * `@silo/app`'s api-role entrypoint (deployable-silo design, Unit 2) — the
 * `api` container's process in the two-container/two-subdomain topology (see
 * the design doc). Runs ONE process serving the web SPA + REST API (via
 * `@silo/api`'s `createApp()`, already static-serving the built web dist as
 * of Unit 1) AND the enrichment worker in-process (via `@silo/worker`'s
 * `startWorker()`).
 *
 * Why this lives in `@silo/app`, not `packages/api/src/main.ts`: `@silo/api`
 * is an ADAPTER (`docs/rules/architecture.md`) — `.dependency-cruiser.cjs`'s
 * `api-no-sibling-adapters` rule (severity error) forbids `@silo/api` from
 * importing `@silo/worker`, and always will (adapters share code through
 * `@silo/core`, never each other). Only the composition root (`@silo/app`) is
 * allowed to import multiple adapters/services to wire one runnable process —
 * exactly the `@silo/app -> @silo/api` + `@silo/app -> @silo/worker` shape
 * this file is. So the single-container "api role" runs THIS entrypoint, not
 * `@silo/api`'s own `main.ts` (which stays the standalone-API-process
 * entrypoint, worker-free, for anyone running api/worker as separate
 * processes instead of this container).
 *
 * Composition mirrors `packages/api/src/main.ts` (port/host reading, the
 * off-loopback warning, the `serve()` call shape, and the close-server-then-
 * stop-background-work shutdown ordering) plus `main.ts` in this same package
 * (the `startWorker()`-before-accepting-requests ordering, so the enqueue seam
 * is live before the first request can race ahead of it).
 *
 * KNOWN LIMITATION (recorded, not fixed here — spec non-goal): a second `api`
 * replica would run a second `startWorker()`, double-running the enrichment
 * work loop AND the scheduled cron jobs (purge-trash / sweep-enriching /
 * dlq-alert) — silent double-execution, not a crash. Acceptable for this
 * single-user tool's current scope (see the design doc's non-goals); scaling
 * to multiple api replicas needs a separate design that moves the worker out
 * of this process.
 */

const DEFAULT_PORT = 8787;
const LOOPBACK_HOST = '127.0.0.1';

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/** The bind address. Loopback unless `HOST` is explicitly set (opt-in exposure). */
function readHost(): string {
  const raw = process.env.HOST;
  return raw !== undefined && raw !== '' ? raw : LOOPBACK_HOST;
}

/**
 * Starts the enrichment worker for this process, degrading rather than
 * crashing on failure — mirrors `packages/api/src/main.ts`'s
 * `startEnqueuer()` posture (a container that can serve reads/writes but not
 * enrich is still useful and restartable) with the same loud, impossible-to-
 * miss stderr banner, reworded for the worker (which also runs the enqueuer
 * seam plus the work loop and scheduled jobs, not just the enqueuer).
 */
async function startWorkerOrDegrade(): Promise<WorkerHandle | undefined> {
  try {
    const worker = await startWorker();
    console.error('[silo/app:api] worker started (enqueuer registered, enrichment loop running)');
    return worker;
  } catch (error) {
    const banner = '========================================================================';
    console.error(banner);
    console.error('[silo/app:api] FATAL-FOR-ENRICHMENT: failed to start the enrichment worker.');
    console.error(
      '[silo/app:api] The api process will keep serving (captures still save), but NEW LINKS ' +
        'WILL NOT ENRICH until this is fixed and the process is restarted.',
    );
    console.error('[silo/app:api] Underlying error:', error);
    console.error(banner);
    return undefined;
  }
}

async function main(): Promise<void> {
  const port = readPort();
  const hostname = readHost();
  const app = createApp();

  if (hostname !== LOOPBACK_HOST) {
    console.error(
      `[silo/app:api] WARNING: bound to ${hostname} (not loopback). The API has NO ` +
        'authentication — it is now reachable off-host and anyone who can reach ' +
        'it can read, modify, and permanently delete your entire store. Only do ' +
        'this on a trusted, isolated network.',
    );
  }

  // Start the worker BEFORE serve() — same ordering rationale as
  // `packages/api/src/main.ts`'s `startEnqueuer()` and this package's own
  // `main.ts`: the enqueue seam must be live before the first request that
  // could create a link, so no capture can race ahead of it.
  const worker = await startWorkerOrDegrade();

  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.error(`[silo/app:api] listening on ${info.address}:${info.port}`);
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.error(`[silo/app:api] received ${signal}, stopping gracefully...`);
    (async () => {
      // Close the SERVER first — stop accepting new connections and let
      // in-flight requests finish — THEN stop the worker, same ordering (and
      // the same race-window rationale) as `packages/api/src/main.ts`'s
      // shutdown: stopping the worker first would leave the server still
      // accepting requests that could reach a stopping/stopped enqueuer.
      let exitCode = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((closeError) => (closeError ? reject(closeError) : resolve()));
        });
      } catch (error: unknown) {
        console.error('[silo/app:api] error closing server:', error);
        exitCode = 1;
      }
      try {
        await worker?.stop();
      } catch (error: unknown) {
        console.error('[silo/app:api] error stopping worker:', error);
        exitCode = 1;
      }
      process.exit(exitCode);
    })().catch((error: unknown) => {
      console.error('[silo/app:api] unexpected error during shutdown:', error);
      process.exit(1);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run `main()` when this file is executed directly (`tsx
// src/api-main.ts`), not when it's imported — `api-main.test.ts` imports
// `readPort`/`readHost` from this module, and without this guard that import
// would ALSO trigger `main()`'s real boot sequence (binding a port, starting
// a real worker) as a side effect. Same idiom as `@silo/worker`'s `worker.ts`
// and this package's own `mcp-http-main.ts`.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('[silo/app:api] fatal startup error:', error);
    process.exit(1);
  });
}

export { readHost, readPort };
