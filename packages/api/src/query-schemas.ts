import type { PageParams } from '@silo/core';
import { CAPTURE_SOURCES, sourceDataSchema } from '@silo/core';
import { z } from 'zod';

/**
 * Shared `?limit=&cursor=` query-string schema for every paginated GET route
 * (`/api/links`, `/api/links/search`, `/api/trash`). Factored out once
 * duplicating it per-route tripped jscpd (mirrors why `link-shape.ts`'s
 * `baseLinkShape` was factored out of the MCP tools — same shape, same
 * reason). `limit` is a query STRING coerced to a number here (HTTP query
 * params are always strings — e.g. `?limit=2`); `core`'s `effectiveLimit`
 * clamps the actual range/default, so this schema only needs to guarantee
 * "an integer, if present" and leave range-checking to core.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  cursor: z.string().optional(),
});

/**
 * Shared `since`/`until` date/datetime query-param validator (agent-
 * navigation slice U5) — mirrors `@silo/mcp-server`'s `tools/query-filters.ts`
 * `isoDateTime` EXACTLY (union of `z.iso.date()` date-only and
 * `z.iso.datetime({ offset: true, local: true })` full ISO datetime) so a
 * malformed `since`/`until` (`?since=yesterday`) is rejected here with a
 * clean `400 validation_error`, never reaching `core.list`/`core.search`'s
 * raw SQL `::timestamptz` cast (which would otherwise throw an unfiltered
 * Postgres error — the same carry-forward-from-U1-review concern the MCP
 * tools' identical schema documents). Deliberately duplicated rather than
 * imported from `@silo/mcp-server`: `@silo/api` and `@silo/mcp-server` are
 * sibling adapters (`docs/rules/architecture.md`) that may each import
 * `@silo/core` and nothing else in the workspace — the two-line duplication
 * is the boundary-required outcome, not an oversight (same rationale
 * `link-json.ts`'s doc comment gives for its own whitelist duplication).
 */
const isoDateTimeQuery = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);

/**
 * The closed set of `source_kind` values the `source` filter accepts on
 * `/api/links`, `/api/links/search`, and their `count_only` mode — mirrors
 * `@silo/mcp-server`'s `tools/query-filters.ts` `SOURCE_KIND_VALUES` so the
 * two adapters' `source` enum can never drift from each other. Duplicated for
 * the same adapter-boundary reason `isoDateTimeQuery` is.
 */
export const SOURCE_KIND_VALUES = ['link', 'hacker_news', 'github', 'youtube', 'twitter'] as const;

/**
 * Shared query-param fragment for the mechanical filters `core.list`/
 * `core.search`/`core.countLinks` all accept beyond the original `tag`/
 * `status` (agent-navigation slice U5): `source`, `tags` (comma-separated —
 * Hono's `c.req.query()` returns the LAST value for a repeated `?tags=a&tags=b`
 * key, not an array, so comma-separation is the only single-value encoding
 * that survives Hono's query parsing without a second `c.req.queries()` call
 * per route; documented on each route's query schema too), `since`/`until`
 * (validated via `isoDateTimeQuery`), and `count_only` (a boolean query flag).
 * Spread into `listQuerySchema`/`searchQuerySchema` below.
 */
export const mechanicalFilterQuerySchema = z.object({
  source: z.enum(SOURCE_KIND_VALUES).optional(),
  tags: z
    .string()
    .min(1)
    .optional()
    .transform((raw) =>
      raw === undefined ? undefined : raw.split(',').filter((t) => t.length > 0),
    ),
  since: isoDateTimeQuery.optional(),
  until: isoDateTimeQuery.optional(),
  // Deliberately NOT `z.coerce.boolean()`: that coerces ANY non-empty string
  // (including the literal `"false"`) to `true` (`Boolean('false') === true`
  // — a well-known Zod/JS footgun), so `?count_only=false` would silently
  // turn count_only ON. Only the literal string `'true'` (case-insensitive,
  // matching how a human/agent would type it) is truthy; anything else
  // (`'false'`, `'0'`, `''`, garbage) is falsy — never a 400, since an
  // unrecognized value degrading to "count_only off" (the default,
  // documented-safe behavior) is better than rejecting an otherwise-valid
  // request over one flag.
  count_only: z
    .string()
    .optional()
    .transform((raw) => raw?.toLowerCase() === 'true'),
});

/** The parsed `{ limit?, cursor? }` query shape every paginated route shares. */
export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * Builds a `core` `PageParams` from a parsed `PageQuery`, CONDITIONALLY (not
 * via object-literal spread): `exactOptionalPropertyTypes` makes
 * `PageParams`'s optional fields reject an explicit `undefined`, and Zod's
 * `.optional()` fields come through as `undefined` when the query param is
 * omitted — mirrors `list-links.ts`'s MCP tool handler, which hits the exact
 * same constraint. Factored out once every paginated route (`/links`,
 * `/links/search`, `/trash`) duplicated this same three-line block and
 * tripped jscpd.
 */
export function toPageParams(query: PageQuery): PageParams {
  const page: PageParams = {};
  if (query.limit !== undefined) page.limit = query.limit;
  if (query.cursor !== undefined) page.cursor = query.cursor;
  return page;
}

/**
 * `POST /api/links` (capture) body schema — plan 007, A3. `sourceKind` mirrors
 * `capture_link`'s MCP input (defaults to `'link'`). `source` (capture-source
 * slice) is the capture SURFACE (`web`/`mcp`/`cli`/`raycast`/`chrome`/
 * `ingest`/`unknown`) — the enum values are imported from `@silo/core`'s
 * `CAPTURE_SOURCES` (the single source of truth) rather than re-listed here,
 * so this schema can't silently drift from core's value set. Absent -> `core.
 * createLink` defaults `'unknown'` (see `links-write.ts`'s route handler).
 */
export const captureBodySchema = z.object({
  url: z.string(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
  sourceKind: z.enum(['link', 'hacker_news', 'twitter']).optional(),
  source: z.enum(CAPTURE_SOURCES).optional(),
});

/**
 * `POST /api/ingest` (trusted, token-gated ingest — CLI foundation slice,
 * plan 020) body schema. THE ONE PLACE `sourceData` IS ACCEPTED ON A CAPTURE
 * BODY: `captureBodySchema` above (the PUBLIC `POST /api/links`) deliberately
 * does NOT expose it — see `routes/ingest.ts`'s doc comment for the full
 * trust-gate design this schema is one half of. `sourceData` is validated
 * against the FULL `sourceDataSchema` union (not just the twitter variant):
 * a trusted local ingest tool may reasonably want to supply pre-extracted
 * data for any source, not only twitter, without a schema change here.
 */
export const ingestBodySchema = z.object({
  url: z.string(),
  sourceKind: z.enum(['link', 'hacker_news', 'twitter']).optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceData: sourceDataSchema.optional(),
  // Capture-source slice: same closed enum as `captureBodySchema` above,
  // imported from `@silo/core`'s `CAPTURE_SOURCES`. Absent -> `ingest.ts`'s
  // route handler falls back to `'ingest'` (a generic ingest caller that
  // didn't self-declare); CLI/Raycast/Chrome self-declare and override it.
  source: z.enum(CAPTURE_SOURCES).optional(),
});

/** The parsed `POST /api/ingest` body shape. */
export type IngestBody = z.infer<typeof ingestBodySchema>;

/** `PATCH /api/links/:id` (edit) body schema — every field optional; an empty body is a valid no-op (returns the current link, per `core.editLink`'s own empty-patch branch). */
export const editBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  note: z.string().optional(),
});

/** `POST /api/links/:id/tags` (add tag) body schema. */
export const addTagBodySchema = z.object({
  tag: z.string().min(1),
});

/** `POST /api/tags` (standalone create-tag) body schema. */
export const createTagBodySchema = z.object({
  name: z.string().min(1),
});

/**
 * Shared `{ ids: string[] }` batch-write body schema (agent-navigation slice
 * U5) — the HTTP mirror of the MCP write tools' `ids[]` batch mode
 * (`add_tag`/`remove_tag`/`trash_link`/`restore_link`/`retry_capture`). Used
 * by every `POST /api/links/batch/*` route below. `min(1)` rejects an empty
 * array as a clean `400 validation_error` (an empty batch has nothing to do
 * and is almost certainly a caller bug, not a legitimate no-op request); the
 * `MAX_BULK_IDS` ceiling itself is enforced by `core`'s bulk fns
 * (`TooManyIdsError`, caught by each route and mapped to `400`) rather than
 * duplicated here as a Zod `.max()` — the route's error message names the
 * exact limit either way, and core is the single source of truth for the cap.
 */
export const batchIdsBodySchema = z.object({
  ids: z.array(z.uuid()).min(1),
});

/** `POST /api/links/batch/tags` (batch add-tag) / `POST /api/links/batch/untag` (batch remove-tag) body schema — `batchIdsBodySchema` plus the one shared `tag` name applied to every id. */
export const batchTagBodySchema = batchIdsBodySchema.extend({
  tag: z.string().min(1),
});

/**
 * `POST /api/links/batch/capture` body schema — the HTTP mirror of
 * `capture_link`'s MCP `urls[]` batch mode. `tags`/`note`/`sourceKind` apply
 * to every url in the batch (same as the MCP tool). `min(1)` on `urls` for
 * the same "empty batch is a caller bug" reason `batchIdsBodySchema` documents.
 */
export const batchCaptureBodySchema = z.object({
  urls: z.array(z.string()).min(1),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
  sourceKind: z.enum(['link', 'hacker_news', 'twitter']).optional(),
});
