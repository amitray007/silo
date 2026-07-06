/**
 * `@silo/queue` public entry.
 *
 * Shared pg-boss primitives for the `enrich-link` queue (plan 013): the queue
 * name/DLQ name/job options (the single source of truth), the `createBoss()`
 * connection factory, `ensureEnrichLinkQueue()`, `logDlqDepth()`, and
 * `registerEnqueuer()` — the seam that wires `@silo/core`'s injectable
 * enqueuer to a real, started `PgBoss` instance.
 *
 * Both `@silo/worker` (send + work) and `@silo/api` (send only, the
 * producer) import this package rather than each other — see
 * `docs/rules/architecture.md` for the boundary this preserves.
 */
export {
  createBoss,
  ENRICH_LINK_DLQ,
  ENRICH_LINK_QUEUE,
  ENRICH_LINK_QUEUE_OPTIONS,
  ensureEnrichLinkQueue,
  logDlqDepth,
  registerEnqueuer,
} from './queue.js';
