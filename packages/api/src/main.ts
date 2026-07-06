import { serve } from '@hono/node-server';
import { createBoss, ensureEnrichLinkQueue, registerEnqueuer } from '@silo/queue';
import { createApp } from './app.js';

/**
 * The serve entrypoint (`pnpm --filter @silo/api dev`/`start`). Loads `.env`
 * via `tsx --env-file-if-exists` (see `package.json`'s scripts — mirrors
 * `@silo/app`'s `main.ts` env-loading story), builds the app from the
 * factory, and hands it to `@hono/node-server`'s `serve` to actually listen.
 * Kept minimal on purpose — all route/error-handling logic lives in
 * `createApp` (`app.ts`), not here.
 *
 * `PORT` defaults to 8787 when unset (see `.env.example`). All diagnostics go
 * to stderr, matching every other adapter entrypoint in this repo (stdout is
 * reserved for protocol/data output on adapters that need it; a plain HTTP
 * server has no such constraint, but stderr-for-logs is kept consistent
 * across `@silo/mcp-server`'s and `@silo/app`'s entrypoints).
 *
 * SECURITY — bind to LOOPBACK (`127.0.0.1`) by default. The API has NO auth
 * (v1 is single-user/localhost, see `api-hono.md`), so it MUST NOT be reachable
 * off-host by default — otherwise anyone on the LAN could read/write/delete the
 * whole store. Binding to all interfaces requires an explicit `HOST` opt-in AND
 * emits a loud stderr warning, so "exposed + unauthenticated" can never happen
 * silently.
 *
 * ENRICHMENT ENQUEUER (plan 013 — the fix this file exists for): the API is a
 * SEPARATE PROCESS from `@silo/worker`, so `@silo/core`'s injectable
 * enqueuer seam (a process-local no-op by default — see
 * `packages/core/src/links/enqueue.ts`) is never wired unless THIS process
 * registers it too. Without this, every HTTP-captured link enqueues nothing
 * and is stranded at `enriching` forever (the worker never sees a job,
 * because none was ever sent). `@silo/queue` (shared with `@silo/worker`)
 * gives us the same `createBoss`/`ensureEnrichLinkQueue`/`registerEnqueuer`
 * trio the worker uses — the API registers ONCE at startup, before `serve()`
 * accepts its first request, so no capture can race ahead of the seam going
 * live. The API's boss is a PRODUCER ONLY: it calls `boss.send()` (via the
 * registered enqueuer) but never `boss.work()`s — consuming stays the
 * worker's job.
 *
 * RELIABILITY (plan 013 decision): if `boss.start()` fails (e.g. Postgres is
 * briefly unreachable at boot), we do NOT crash the API process. A failed
 * enqueuer means new captures won't enrich automatically — degraded, but the
 * API's core job (saving links, serving reads) still works, and is arguably
 * MORE valuable to keep serving than to take the whole store offline over a
 * transient DB hiccup that a retry/restart would likely clear. We log the
 * failure as loudly as possible (repeated, impossible-to-miss stderr output)
 * so a mis-wired or degraded deployment is never silently stranding every new
 * link — the exact failure mode this fix exists to close. Operators running
 * `pnpm dev`/`start` will see this immediately in the console.
 *
 * KNOWN LIMITATION (recorded, not built here — out of scope for this fix):
 * there is currently NO retry/reconnect after a failed `startEnqueuer()` and
 * NO product-surface signal (health endpoint, response header) beyond the
 * stderr banner — a process left running unattended (e.g. under a process
 * manager whose stderr isn't watched) could stay silently degraded even after
 * the underlying DB issue clears. Acceptable for this single-user/localhost
 * tool's current scope; a follow-up increment could add periodic re-attempt
 * and/or a `/health` route surfacing enqueuer state, if this ever bites in
 * practice.
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
 * Start the enrichment enqueuer: connect a producer-only pg-boss, ensure the
 * queue exists, and register core's enqueue seam. Returns the started `boss`
 * on success so it can be stopped gracefully on shutdown, or `undefined` if
 * startup failed — the caller decides how loud to be and whether to keep
 * serving (see the RELIABILITY note above the module doc comment).
 */
async function startEnqueuer(): Promise<ReturnType<typeof createBoss> | undefined> {
  // Declared outside the try so the catch can stop a boss that already
  // STARTED before a LATER step (ensureEnrichLinkQueue / registerEnqueuer)
  // threw — otherwise that started instance's DB connections/listeners leak
  // for the process lifetime, since main() only ever holds the returned value
  // (review fix, was: `const boss` scoped inside try).
  let boss: ReturnType<typeof createBoss> | undefined;
  try {
    boss = createBoss();
    boss.on('error', (error) => {
      // Mirror the worker's own pg-boss error handling: log rather than let
      // an unhandled 'error' event crash the process.
      console.error('[silo/api] pg-boss error:', error);
    });
    await boss.start();
    await ensureEnrichLinkQueue(boss);
    registerEnqueuer(boss);
    console.error(
      '[silo/api] enrichment enqueuer registered — captures will enqueue for enrichment.',
    );
    return boss;
  } catch (error) {
    // LOUD, repeated, impossible-to-miss: a mis-wired/degraded enqueuer must
    // never fail silently (that is exactly the bug this file exists to fix).
    // We degrade rather than crash: captures still save, they just won't
    // auto-enqueue until the enqueuer comes up (a restart, once the
    // underlying issue — e.g. Postgres unreachable — clears).
    const banner = '========================================================================';
    console.error(banner);
    console.error('[silo/api] FATAL-FOR-ENRICHMENT: failed to start the enrichment enqueuer.');
    console.error(
      '[silo/api] The API will keep serving (captures still save), but NEW LINKS ' +
        'WILL NOT ENRICH until this is fixed and the process is restarted.',
    );
    console.error('[silo/api] Underlying error:', error);
    console.error(banner);
    // boss.start() may have already succeeded before the failing step — stop
    // it (non-graceful is fine, it never began working jobs) so a degraded
    // startup doesn't leak the open connection. Swallow any stop error: we're
    // already on the failure path and about to return `undefined` regardless.
    await boss?.stop({ graceful: false }).catch(() => {});
    return undefined;
  }
}

async function main(): Promise<void> {
  const port = readPort();
  const hostname = readHost();
  const app = createApp();

  if (hostname !== LOOPBACK_HOST) {
    console.error(
      `[silo/api] WARNING: bound to ${hostname} (not loopback). The API has NO ` +
        'authentication — it is now reachable off-host and anyone who can reach ' +
        'it can read, modify, and permanently delete your entire store. Only do ' +
        'this on a trusted, isolated network.',
    );
  }

  // Register the enqueuer BEFORE serve() so the very first request that
  // creates a link can enqueue it — no window where a capture could race
  // ahead of the seam going live.
  const boss = await startEnqueuer();

  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.error(`[silo/api] listening on ${info.address}:${info.port}`);
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.error(`[silo/api] received ${signal}, stopping gracefully...`);
    (async () => {
      // Order matters (review fix): close the SERVER first — stop accepting
      // new connections and let in-flight requests finish — THEN stop the
      // enqueuer boss. The reverse order left a race window: while
      // `boss.stop()` was in flight the server was still serving, so a request
      // reaching the registered enqueue seam could call `.send()` on a
      // stopping boss and throw outside any handled path.
      let exitCode = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((closeError) => (closeError ? reject(closeError) : resolve()));
        });
      } catch (error: unknown) {
        console.error('[silo/api] error closing server:', error);
        exitCode = 1;
      }
      try {
        await boss?.stop({ graceful: true });
      } catch (error: unknown) {
        console.error('[silo/api] error stopping enqueuer boss:', error);
        exitCode = 1;
      }
      process.exit(exitCode);
    })().catch((error: unknown) => {
      console.error('[silo/api] unexpected error during shutdown:', error);
      process.exit(1);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error('[silo/api] fatal startup error:', error);
  process.exit(1);
});
