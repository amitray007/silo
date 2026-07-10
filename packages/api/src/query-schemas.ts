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
