/**
 * @silo/worker public entry.
 *
 * This slice (U2) ships only the SSRF-safe fetch module — extraction (U3),
 * the core write path (U4), and the pg-boss queue/worker entrypoint (U5)
 * land in later units of the same feature slice.
 */

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
