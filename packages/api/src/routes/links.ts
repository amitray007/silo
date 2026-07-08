import type { ListFilter } from '@silo/core';
import { getById, list, search } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { toLinkJson, toSearchResultJson } from '../link-json.js';
import { pageQuerySchema, toPageParams } from '../query-schemas.js';

/**
 * `GET /api/links` query schema: `tag`/`status` filter `core.list`'s
 * `ListFilter`; `limit`/`cursor` are the shared page params
 * (`pageQuerySchema`). An invalid `status` (not one of the four capture
 * statuses) fails Zod parsing -> the app's `onError` maps the thrown
 * `ZodError` to `400 validation_error` — the route never has to hand-check it.
 */
const listQuerySchema = pageQuerySchema.extend({
  tag: z.string().optional(),
  status: z.enum(['enriching', 'full', 'partial', 'bare']).optional(),
});

/**
 * `GET /api/links/search` query schema: `q` is required (min length 1) so an
 * empty/missing query is a 400, not a full unfiltered scan. `tag` (optional,
 * command-center search plan 024) additively scopes results to that exact
 * tag — see `core.search`'s doc comment for the AND semantics.
 */
const searchQuerySchema = pageQuerySchema.extend({
  q: z.string().min(1),
  tag: z.string().optional(),
});

/** `GET /api/links/:id` param schema — a non-uuid `id` is a 400, not a pointless DB round-trip that would always miss. */
const idParamSchema = z.object({
  id: z.uuid(),
});

/**
 * Registers the read routes over `core.list`/`core.search`/`core.getById`
 * (plan 007, A2). Mounted under `/api` by `app.ts`. Route ORDER matters:
 * `/links/search` is registered before `/links/:id` so Hono's router matches
 * the literal `search` segment first — if `:id` were registered first, a
 * request to `/api/links/search` would match `:id = "search"` (which then
 * fails `z.uuid()` as a 400, masking the search route entirely). Both routes
 * are declared on this same sub-app in the order below, which is sufficient;
 * see `links.test.ts`'s ordering test for the behavioral proof.
 */
export function registerLinksRoutes(app: Hono): void {
  app.get('/links/search', async (c) => {
    const query = searchQuerySchema.parse(c.req.query());
    const result = await search(query.q, query.tag, toPageParams(query));
    const results = result.results.map((link) => toSearchResultJson(link, link.rank));
    return c.json(
      result.nextCursor === undefined ? { results } : { results, nextCursor: result.nextCursor },
    );
  });

  app.get('/links/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const link = await getById(id);
    if (!link) {
      return c.json({ error: 'not_found', message: `No link with id ${id}` }, 404);
    }
    // `{ link }` (not a bare link) so a single link has the SAME envelope on the
    // read path as on every write path (PATCH/capture/tag/trash/restore/retry all
    // return `{ link }`) — a client uses one unwrap for the resource, not per-verb.
    return c.json({ link: toLinkJson(link) });
  });

  app.get('/links', async (c) => {
    const query = listQuerySchema.parse(c.req.query());

    // Built conditionally, not via object-literal spread: `exactOptionalPropertyTypes`
    // makes `ListFilter`/`PageParams`'s optional fields reject an explicit
    // `undefined`, and Zod's `.optional()` fields come through as `undefined`
    // when the query param is omitted (mirrors `list-links.ts`'s MCP tool
    // handler, which hits the exact same constraint).
    const filter: ListFilter = {};
    if (query.tag !== undefined) filter.tag = query.tag;
    if (query.status !== undefined) filter.status = query.status;

    const result = await list(filter, toPageParams(query));
    const links = result.links.map(toLinkJson);
    return c.json(
      result.nextCursor === undefined ? { links } : { links, nextCursor: result.nextCursor },
    );
  });
}
