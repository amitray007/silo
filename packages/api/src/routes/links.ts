import type { CountFilter, ListFilter, SearchFilter } from '@silo/core';
import { countLinks, findRelated, getById, list, search } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  toLinkJson,
  toLinkWithTextWindowJson,
  toSnippetLinkJson,
  toSnippetSearchResultJson,
} from '../link-json.js';
import {
  mechanicalFilterQuerySchema,
  pageQuerySchema,
  type SOURCE_KIND_VALUES,
  toPageParams,
} from '../query-schemas.js';

/**
 * `GET /api/links` query schema (agent-navigation slice U5): the original
 * `tag`/`status` filters plus the mechanical filter fragment
 * (`source`/`tags`/`since`/`until`/`count_only`, `../query-schemas.js`) —
 * mirrors `list_links`'s MCP `inputSchema` (`packages/mcp/server/src/tools/
 * list-links.ts`). An invalid `status`/`source`/`since`/`until` fails Zod
 * parsing -> the app's `onError` maps the thrown `ZodError` to
 * `400 validation_error` — the route never has to hand-check it.
 */
const listQuerySchema = pageQuerySchema.merge(mechanicalFilterQuerySchema).extend({
  tag: z.string().optional(),
  status: z.enum(['enriching', 'full', 'partial', 'bare']).optional(),
});

/**
 * `GET /api/links/search` query schema (agent-navigation slice U5): `q` is
 * required (min length 1) so an empty/missing query is a 400, not a full
 * unfiltered scan. `tag` (optional, command-center search plan 024)
 * additively scopes results to that exact tag — see `core.search`'s doc
 * comment for the AND semantics; when present it ALSO requires min length 1
 * (review fix — an empty `?tag=` must 400, not silently degrade to an
 * unscoped search). Plus the same mechanical filter fragment `listQuerySchema`
 * carries, plus `sort` — mirrors `search_links`'s MCP `inputSchema`.
 */
const searchQuerySchema = pageQuerySchema.merge(mechanicalFilterQuerySchema).extend({
  q: z.string().min(1),
  tag: z.string().min(1).optional(),
  sort: z.enum(['relevance', 'newest', 'oldest']).optional(),
});

/** `GET /api/links/:id` param schema — a non-uuid `id` is a 400, not a pointless DB round-trip that would always miss. */
const idParamSchema = z.object({
  id: z.uuid(),
});

/**
 * `GET /api/links/:id` query schema (agent-navigation slice U5): an optional
 * `textOffset`/`textLimit` PAIR (both required together, or both omitted) —
 * mirrors `get_link`'s MCP `textWindow: { offset, limit }` input, expressed
 * as two flat query params since HTTP query strings have no native nested-
 * object syntax. `.refine` enforces the pairing so a caller can't send only
 * one half and get a confusingly-defaulted window.
 */
const detailQuerySchema = z
  .object({
    textOffset: z.coerce.number().int().min(0).optional(),
    textLimit: z.coerce.number().int().min(1).optional(),
  })
  .refine((q) => (q.textOffset === undefined) === (q.textLimit === undefined), {
    message: 'textOffset and textLimit must be given together',
  });

/** `GET /api/links/:id/related` query schema — `limit` mirrors `find_related`'s MCP `limit` param (clamped to [1, 50] by `core.findRelated`, default 10). */
const relatedQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
});

/**
 * Builds a `core` `ListFilter`/`SearchFilter`/`CountFilter` from the parsed
 * mechanical-filter query fragment, CONDITIONALLY (not via object-literal
 * spread): `exactOptionalPropertyTypes` makes every one of these types'
 * optional fields reject an explicit `undefined`, and Zod's `.optional()`
 * fields come through as `undefined` when the query param is omitted —
 * mirrors `list-links.ts`/`search-links.ts`'s MCP tool handlers, which hit
 * the exact same constraint. `source` is typed as the closed
 * `SOURCE_KIND_VALUES` union by the query schema but `ListFilter.source` is a
 * bare `string` (core never validates it against a closed set — see its doc
 * comment), so no cast is needed either way.
 */
function buildMechanicalFilter<
  T extends { source?: string; tags?: string[]; since?: string; until?: string },
>(query: {
  source?: (typeof SOURCE_KIND_VALUES)[number] | undefined;
  tags?: string[] | undefined;
  since?: string | undefined;
  until?: string | undefined;
}): T {
  const filter = {} as T;
  if (query.source !== undefined) filter.source = query.source;
  if (query.tags !== undefined) filter.tags = query.tags;
  if (query.since !== undefined) filter.since = query.since;
  if (query.until !== undefined) filter.until = query.until;
  return filter;
}

/**
 * Registers the read routes over `core.list`/`core.search`/`core.getById`/
 * `core.countLinks`/`core.findRelated` (plan 007 A2, extended agent-
 * navigation slice U5). Mounted under `/api` by `app.ts`. Route ORDER
 * matters: `/links/search` is registered before `/links/:id` so Hono's
 * router matches the literal `search` segment first — if `:id` were
 * registered first, a request to `/api/links/search` would match
 * `:id = "search"` (which then fails `z.uuid()` as a 400, masking the search
 * route entirely). `/links/:id/related` is registered after `/links/:id` (a
 * more specific path under the same `:id` segment — Hono matches it
 * correctly either way, but keeping it adjacent to `/links/:id` reads
 * naturally). Both routes are declared on this same sub-app in the order
 * below, which is sufficient; see `links.test.ts`'s ordering test for the
 * behavioral proof.
 */
export function registerLinksRoutes(app: Hono): void {
  app.get('/links/search', async (c) => {
    const query = searchQuerySchema.parse(c.req.query());
    // Built conditionally (not `{ tag: query.tag }`), matching `list()`'s own
    // `ListFilter` construction just below: `exactOptionalPropertyTypes`
    // rejects an explicit `tag: undefined` against `SearchFilter`'s
    // `tag?: string` — the field must be OMITTED, not present-with-undefined,
    // when the query param wasn't supplied.
    const searchFilter = buildMechanicalFilter<SearchFilter>(query);
    if (query.tag !== undefined) searchFilter.tag = query.tag;
    if (query.sort !== undefined) searchFilter.sort = query.sort;

    if (query.count_only) {
      const countFilter = buildMechanicalFilter<CountFilter>(query);
      countFilter.query = query.q;
      if (query.tag !== undefined) countFilter.tag = query.tag;
      const counts = await countLinks(countFilter);
      return c.json(counts);
    }

    const result = await search(query.q, searchFilter, toPageParams(query));
    const results = result.results.map(toSnippetSearchResultJson);
    return c.json(
      result.nextCursor === undefined ? { results } : { results, nextCursor: result.nextCursor },
    );
  });

  app.get('/links/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const { textOffset, textLimit } = detailQuerySchema.parse(c.req.query());

    if (textOffset !== undefined && textLimit !== undefined) {
      const windowed = await getById(id, { textWindow: { offset: textOffset, limit: textLimit } });
      if (!windowed) {
        return c.json({ error: 'not_found', message: `No link with id ${id}` }, 404);
      }
      return c.json({ link: toLinkWithTextWindowJson(windowed) });
    }

    const link = await getById(id);
    if (!link) {
      return c.json({ error: 'not_found', message: `No link with id ${id}` }, 404);
    }
    // `{ link }` (not a bare link) so a single link has the SAME envelope on the
    // read path as on every write path (PATCH/capture/tag/trash/restore/retry all
    // return `{ link }`) — a client uses one unwrap for the resource, not per-verb.
    return c.json({ link: toLinkJson(link) });
  });

  /**
   * `GET /api/links/:id/related` (agent-navigation slice U5) — "more like
   * this", mirrors `find_related`'s MCP handler
   * (`packages/mcp/server/src/tools/find-related.ts`): a seeded `search()`
   * call over the seed link's own tags/title terms, no query needed. An
   * unknown/trashed seed id or a seed with no mechanical signal (no tags, no
   * usable title words) both resolve to `{ results: [] }` — a normal 200, not
   * a 404 — since `core.findRelated` itself makes no found/not-found
   * distinction (see its doc comment).
   */
  app.get('/links/:id/related', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const { limit } = relatedQuerySchema.parse(c.req.query());

    const rows = await findRelated(id, limit);
    const results = rows.map(toSnippetSearchResultJson);
    return c.json({ results, count: results.length });
  });

  app.get('/links', async (c) => {
    const query = listQuerySchema.parse(c.req.query());

    // Built conditionally, not via object-literal spread: `exactOptionalPropertyTypes`
    // makes `ListFilter`/`PageParams`'s optional fields reject an explicit
    // `undefined`, and Zod's `.optional()` fields come through as `undefined`
    // when the query param is omitted (mirrors `list-links.ts`'s MCP tool
    // handler, which hits the exact same constraint).
    const filter = buildMechanicalFilter<ListFilter>(query);
    if (query.tag !== undefined) filter.tag = query.tag;
    if (query.status !== undefined) filter.status = query.status;

    if (query.count_only) {
      // `countLinks` has no `status` filter (counts are always over live
      // links — see its doc comment), so `status` is dropped from the count
      // path the same way `list_links`'s MCP `count_only` mode does
      // (`buildCountFilter` in `list-links.ts`).
      const countFilter = buildMechanicalFilter<CountFilter>(query);
      if (query.tag !== undefined) countFilter.tag = query.tag;
      const counts = await countLinks(countFilter);
      return c.json(counts);
    }

    const result = await list(filter, toPageParams(query));
    const links = result.links.map(toSnippetLinkJson);
    return c.json(
      result.nextCursor === undefined ? { links } : { links, nextCursor: result.nextCursor },
    );
  });
}
