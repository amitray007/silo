export const name = '@silo/core';

// URL canonicalization (U3): the normalize-url wrapper + dedup key used by
// `createLink`/`findByCanonicalUrl`.
export type { CanonicalizeResult } from './links/canonicalize.js';
export { canonicalize } from './links/canonicalize.js';

// Core link operations (U4): the typed data-access primitives the UI and
// MCP adapters both call — create (dedup/merge), read, list, search, edit,
// tag, trash/restore. See docs/rules/architecture.md — this is the one
// place business logic over `@silo/db` lives.
export type {
  CreateLinkInput,
  EditLinkInput,
  Link,
  ListFilter,
  RestoreResult,
  SearchResult,
} from './links/links.js';
export {
  addTag,
  createLink,
  editLink,
  findByCanonicalUrl,
  getById,
  list,
  removeTag,
  restore,
  search,
  softDelete,
} from './links/links.js';

// Trash purge (U5): bounded, batched, unscheduled — see purgeTrash's doc
// comment for the batching/termination argument. Scheduling (pg-boss) is a
// later increment; this is the callable query.
export type { PurgeTrashOptions } from './links/purge.js';
export { purgeTrash } from './links/purge.js';

// Per-source `source_data` validation (U3): the Zod discriminated union
// keyed on `source_kind`, and its inferred type.
export type { SourceData } from './links/source-data.js';
export { sourceDataSchema } from './links/source-data.js';
