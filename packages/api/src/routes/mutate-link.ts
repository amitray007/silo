import { getById } from '@silo/core';
import type { Context } from 'hono';
import { toLinkJson } from '../link-json.js';

/**
 * Shared "mutate -> re-fetch -> shape -> respond" helper for the A3 write
 * routes (plan 007). Every write route here follows the exact same pattern
 * the MCP write tools use (see `packages/mcp/server/src/tools/add-tag.ts`'s
 * doc comment): the underlying `core` mutation (`createLink`/`editLink`/
 * `addTag`/`removeTag`) either returns a bare `Link` (no `tags`) or `void`,
 * so every route re-fetches the hydrated `LinkWithTags` via `getById` before
 * shaping the HTTP response — never shapes the mutation's own return value
 * directly.
 *
 * Factored out once `POST /api/links`, `PATCH /api/links/:id`,
 * `POST /api/links/:id/tags`, and `DELETE /api/links/:id/tags/:tag` all
 * duplicated this same "re-fetch by id, 404 if somehow gone, else 200/201
 * with `{ link }`" tail and tripped jscpd — mirrors why `pageQuerySchema`/
 * `toPageParams` were factored out of the A2 read routes for the same reason.
 *
 * The "link vanished between mutate and re-fetch" branch is a defensive
 * 404 (matches the MCP tools' equivalent guard), not an assertion — it
 * shouldn't happen in practice (nothing else in-process deletes rows
 * between the two calls on a single request), but a clean error beats a
 * thrown `TypeError` reaching a client if it ever does.
 */
export async function respondWithLink(
  c: Context,
  id: string,
  status: 200 | 201,
): Promise<Response> {
  const link = await getById(id);
  if (!link) {
    return c.json(
      { error: 'not_found', message: `No live link with id ${id} to return after this write` },
      404,
    );
  }
  return c.json({ link: toLinkJson(link) }, status);
}
