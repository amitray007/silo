/**
 * @silo/worker public entry.
 *
 * This slice ships the SSRF-safe fetch module (U2) and static-first
 * extraction (U3) — the core write path (U4) and the pg-boss queue/worker
 * entrypoint (U5) land in later units of the same feature slice.
 */

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
