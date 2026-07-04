import type { PageParams } from '@silo/core';
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
