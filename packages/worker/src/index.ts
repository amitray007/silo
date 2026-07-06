/**
 * @silo/worker public entry.
 *
 * This slice ships the SSRF-safe fetch module (U2), static-first extraction
 * (U3), the core write path (U4), the pg-boss queue + worker entrypoint (U5),
 * and the public `startWorker()` runtime API (plan 005, A1). `worker.ts`'s
 * `main()` process wiring (signal handling, console logging) and its
 * main-module guard stay private — but `startWorker()` itself (the boot
 * sequence: connect pg-boss, ensure the queue, register the enqueuer, run the
 * enrichment work loop) IS a public export: `@silo/app` (the composition
 * root, plan 005 A2) imports `@silo/worker` as a library to run the
 * enrichment worker in-process alongside other adapters, rather than as a
 * separate OS process. The standalone `pnpm --filter @silo/worker start` /
 * `node dist/worker.js` process boundary (for scale-out) still exists too,
 * registered as a knip entry (see knip.json).
 */

// Enrichment job (U5): the `enrich-link` handler's business logic — fetch ->
// extract -> recordEnrichment, with injectable seams for testing. See
// enrich.ts's doc comment for the resolve-vs-throw contract pg-boss relies on.
export { type EnrichLinkDeps, enrichLink } from './enrich.js';
// NOTE: embedded-json.ts's `recoverEmbeddedJson`/`EmbeddedJsonResult` are
// deliberately NOT re-exported here — they are internal tier-3 plumbing for
// `extract()`'s pipeline (imported directly by extract.ts via a relative
// path), not a standalone public capability of @silo/worker. `extract()` is
// the unit's only real public surface; re-export the internal helper only
// if/when a genuine external caller needs it standalone.
export {
  type CaptureStatus,
  type ExtractInput,
  type ExtractResult,
  extract,
} from './extract/extract.js';
export { classifyIp, type IpClassification, isBlockedIp } from './fetch/ip-rules.js';
export {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  type Resolver,
  type SafeFetchFailureReason,
  type SafeFetchOptions,
  type SafeFetchResult,
  safeFetch,
} from './fetch/safe-fetch.js';
// pg-boss queue (U5; moved to @silo/queue in plan 013): queue name/options,
// the boss connection factory, and queue-setup helper now live in
// `@silo/queue` (shared with `@silo/api` — see that package's index for the
// same primitives). No longer re-exported here; import `@silo/queue`
// directly for these.
// Public runtime API (plan 005, A1): the composable boot sequence a
// composition-root process calls to start the enrichment worker in-process.
// Importing this module is side-effect-free — only calling `startWorker()`
// connects pg-boss / registers the enqueuer / starts the work loop.
export { startWorker, type WorkerHandle } from './worker.js';
