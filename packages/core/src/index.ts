export const name = '@silo/core';

// Web-login primitives (web-auth cookie upgrade, U1): the human
// `SILO_APP_PASSWORD` check + the `silo_session` signed-cookie secret/name/
// value/max-age constants, shared by `@silo/api`'s login/logout routes and
// its general auth gate so all of them read one source of truth. The actual
// cookie sign/verify (`setSignedCookie`/`getSignedCookie`) stays at the
// `@silo/api` edge — see `auth/app-session.ts`'s doc comment for why core
// only owns the secret + the password check, not the Hono cookie mechanics.
export {
  readAppPassword,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  SESSION_MAX_AGE_SECONDS,
  sessionSecret,
  verifyAppPassword,
} from './auth/app-session.js';
// Auth token primitives (MCP-HTTP slice, U1): timing-safe secret compare +
// env-var token read, moved here from `@silo/api`'s `token-auth.ts` so
// `@silo/app`'s HTTP MCP listener can reuse them without importing an
// adapter (`@silo/app` may not import `@silo/api` — see
// docs/rules/architecture.md). `@silo/api` re-exports both from
// `token-auth.ts` so its own existing call sites (`ingest-auth.ts`,
// `general-auth.ts`) are unaffected.
export { readTokenEnv, timingSafeEqual } from './auth/token.js';
// Named DB-backed access tokens (access-tokens slice, U1): mint/list/revoke/
// verify credentials from the web UI, checked by the API/MCP auth gates
// alongside the env SILO_API_TOKEN. See `auth/tokens.ts`'s doc comments for
// the hashing + timing-posture rationale.
export type { AccessTokenSummary, CreatedAccessToken } from './auth/tokens.js';
export {
  generateAccessToken,
  InvalidAccessTokenNameError,
  listAccessTokens,
  revokeAccessToken,
  TOKEN_PREFIX_LEN,
  verifyAccessToken,
} from './auth/tokens.js';
// URL canonicalization (U3): the normalize-url wrapper + dedup key used by
// `createLink`/`findByCanonicalUrl`.
export type { CanonicalizeResult } from './links/canonicalize.js';
export { canonicalize } from './links/canonicalize.js';
// Source detection (source-data/rich-previews slice): pure URL -> source-kind
// classification (HN item / GitHub repo / YouTube video / plain link). Used
// by `createLink` to auto-derive `sourceKind`, and re-run by the worker's
// per-source enrichers to recover the parsed id/owner/repo/videoId.
export type { DetectedSource } from './links/detect-source.js';
export { detectSource } from './links/detect-source.js';
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
export {
  ENRICH_ATTEMPT_CAP,
  enrichmentResultSchema,
  recordEnrichment,
  requestRetry,
  settleGiveUp,
} from './links/enrichment.js';
// Executor types (shared db/tx handle) — the worker's real enqueuer is typed
// against these.
export type { Db, Executor, Tx } from './links/executor.js';
// Export (export-JSON-YAML-CSV slice, U1): exportLinks reads the full live
// library (trash excluded) and serializes it to JSON (default, lossless),
// YAML (same object, lossless), or CSV (flat partial view — drops
// sourceData/extractedText). One shared row->object mapper backs all three
// serializers so they can never drift on which fields exist. See
// export.ts's doc comments for the format-by-format contract.
export type { ExportFormat, ExportResult } from './links/export.js';
export { EXPORT_VERSION, exportLinks, InvalidExportFormatError } from './links/export.js';
// Import (import slice, U1): importLinks is the write half of the export/
// import round-trip — restores a silo `version: 1` JSON export back into the
// store, reusing `createLink`'s existing canonical-URL dedup-merge (no new
// write path). Envelope-invalid payloads throw `InvalidImportError`;
// per-link failures are collected into `ImportResult.skipped` rather than
// failing the whole import. See import.ts's doc comments for the full
// validation/dedup contract.
export type { ImportResult, ImportSkip } from './links/import.js';
export { InvalidImportError, importLinks, MAX_IMPORT_LINKS } from './links/import.js';
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
  SearchFilter,
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
// Capture-source provenance (capture-source slice): the closed value set +
// type for `CreateLinkInput.source` / `Link.source` — the SURFACE a link was
// captured through, orthogonal to `addedBy`. Single source of truth,
// mirrored (not re-declared) by `@silo/db`'s `captureSource` pgEnum and the
// API/MCP layers where they're allowed to import `@silo/core`.
export type { CaptureSource } from './links/source.js';
export { CAPTURE_SOURCES } from './links/source.js';
// Per-source `source_data` validation (U3): the Zod discriminated union
// keyed on `source_kind`, and its inferred type.
export type { SourceData } from './links/source-data.js';
export { sourceDataSchema } from './links/source-data.js';
// Stranded-enriching sweep (scheduling-jobs slice): a live-scoped, bounded
// FIND for links stuck at capture_status='enriching' past a staleness
// window. Core exposes the find only — re-enqueueing (via requestRetry) is
// the caller's (the worker's scheduled job) job, keeping core free of any
// pg-boss dependency. See sweep.ts's doc comment for the full split rationale.
export type { FindStrandedEnrichingOptions, StrandedLink } from './links/sweep.js';
export { findStrandedEnriching } from './links/sweep.js';
// Tag list with live-link counts (plan 007, C3): the sidebar's per-tag
// counts, e.g. "ai 23" — see tags.ts for the zero-count/ordering decisions.
export type { TagCount } from './links/tags.js';
export { createTag, listTagsWithCounts } from './links/tags.js';
// Trash reads + counts (plan 007, C2): listTrash is the ONE read in this
// package deliberately NOT scoped through `whereLive` — see trash.ts's doc
// comment for why it's quarantined in its own module. getCounts/countLive/
// countTrash back the mockup's sidebar live/trash counts. searchTrash is the
// trash-scoped mirror of `search` (Trash search slice) — same ranking/
// pagination, reusing the live search's `SearchPage` type since the shape is
// identical.
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
  searchTrash,
} from './links/trash.js';

// Settings persistence (plan 016): a single-user key -> value store —
// theme/trash-purge-cycle/plugin-toggle settings the web Settings modal
// reads + writes. Appended as its own minimal block (this barrel is shared
// with the parallel scheduling slice) — see `settings/schema.ts` for the
// per-key allowlist + defaults.
export type { SettingKey, SettingsMap, SettingValue } from './settings/schema.js';
export { SETTINGS_DEFAULTS } from './settings/schema.js';
export { getAllSettings, getSetting, setSetting, updateSettings } from './settings/settings.js';
