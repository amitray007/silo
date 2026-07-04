/**
 * @silo/worker public entry.
 *
 * This slice ships the SSRF-safe fetch module (U2), static-first extraction
 * (U3), the core write path (U4), and the pg-boss queue + worker entrypoint
 * (U5). `worker.ts` (the long-lived process entrypoint) and its `main()`
 * guard are deliberately NOT re-exported here — nothing in the workspace
 * imports `@silo/worker` as a library (it has no adapter consumers per
 * architecture.md), so the only "export" that matters for the entrypoint is
 * the `pnpm --filter @silo/worker start` / `node dist/worker.js` process
 * boundary itself, registered as a knip entry (see knip.json) rather than a
 * package export.
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
// pg-boss queue (U5): queue name/options shared (by literal duplication —
// see enqueue.ts in @silo/core) with the send side, and the WORK-side PgBoss
// factory used only by worker.ts's entrypoint.
export {
  createWorkerBoss,
  ENRICH_LINK_DLQ,
  ENRICH_LINK_QUEUE,
  ENRICH_LINK_QUEUE_OPTIONS,
  ensureEnrichLinkQueue,
} from './queue.js';
