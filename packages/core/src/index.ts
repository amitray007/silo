export const name = '@silo/core';

// URL canonicalization (U3): the normalize-url wrapper + dedup key used by
// `createLink`/`findByCanonicalUrl`.
export type { CanonicalizeResult } from './links/canonicalize.js';
export { canonicalize } from './links/canonicalize.js';
// Enrichment enqueue seam (enrichment-worker slice): createLink enqueues via a
// registered enqueuer (no-op by default). The worker registers the real
// pg-boss send at startup via setEnrichmentEnqueuer — this keeps core free of
// any @silo/worker dependency (dependency flows adapter -> core).
export type { EnrichmentEnqueuer } from './links/enqueue.js';
export {
  ENRICH_LINK_QUEUE,
  enqueueEnrichment,
  resetEnrichmentEnqueuer,
  setEnrichmentEnqueuer,
} from './links/enqueue.js';
// Enrichment write path (increment 3, U4): recordEnrichment writes an
// enrichment result (metadata + terminal capture_status) onto a live link;
// requestRetry resets a live link back to `enriching` for a user-triggered
// retry. Both are live-scoped — trashed links are never touched/resurrected.
// The actual fetch/extract/enqueue is the worker's job (U2/U3/U5).
export type { EnrichmentResult } from './links/enrichment.js';
export { enrichmentResultSchema, recordEnrichment, requestRetry } from './links/enrichment.js';
// Executor types (shared db/tx handle) — the worker's real enqueuer is typed
// against these.
export type { Db, Executor, Tx } from './links/executor.js';
// Core link operations (U4): the typed data-access primitives the UI and
// MCP adapters both call — create (dedup/merge), read, list, search, edit,
// tag, trash/restore. See docs/rules/architecture.md — this is the one
// place business logic over `@silo/db` lives.
export type {
  CreateLinkInput,
  EditLinkInput,
  Link,
  LinkWithTags,
  ListFilter,
  ListPage,
  PageParams,
  RestoreResult,
  SearchPage,
  SearchResult,
} from './links/links.js';
export {
  addTag,
  createLink,
  editLink,
  findByCanonicalUrl,
  getById,
  InvalidCursorError,
  list,
  removeTag,
  restore,
  search,
  softDelete,
  willDedupCapture,
} from './links/links.js';
// Trash purge (U5): bounded, batched, unscheduled — see purgeTrash's doc
// comment for the batching/termination argument. Scheduling (pg-boss) is a
// later increment; this is the callable query.
export type { PurgeTrashOptions } from './links/purge.js';
export { PURGE_WINDOW_DAYS, purgeTrash } from './links/purge.js';
// Per-source `source_data` validation (U3): the Zod discriminated union
// keyed on `source_kind`, and its inferred type.
export type { SourceData } from './links/source-data.js';
export { sourceDataSchema } from './links/source-data.js';
// Tag list with live-link counts (plan 007, C3): the sidebar's per-tag
// counts, e.g. "ai 23" — see tags.ts for the zero-count/ordering decisions.
export type { TagCount } from './links/tags.js';
export { createTag, listTagsWithCounts } from './links/tags.js';
// Trash reads + counts (plan 007, C2): listTrash is the ONE read in this
// package deliberately NOT scoped through `whereLive` — see trash.ts's doc
// comment for why it's quarantined in its own module. getCounts/countLive/
// countTrash back the mockup's sidebar live/trash counts.
// hardDelete/emptyTrash (plan 007, C3): DESTRUCTIVE, trashed-only targeted
// deletes (the mockup's "delete now"/"empty now") — see trash.ts's doc
// comments for the atomic WHERE-clause guard that makes a live link
// unreachable by either.
export type { Counts, TrashPage } from './links/trash.js';
export {
  countLive,
  countTrash,
  emptyTrash,
  getCounts,
  hardDelete,
  listTrash,
} from './links/trash.js';
