import type { CreateLinkInput } from '@silo/core';
import { canonicalize, createLink, getById, willDedupCapture } from '@silo/core';
import type { Context } from 'hono';
import { z } from 'zod';
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

/**
 * Shared "capture" tail for both `POST /api/links` (the public capture
 * route, `links-write.ts`) and `POST /api/ingest` (the trusted, token-gated
 * ingest seam, `ingest.ts` — plan 020). Both routes create a link the exact
 * same way: bad-URL guard -> best-effort dedup pre-check -> `core.createLink`
 * -> map a `ZodError` to `400 validation_error` -> re-fetch + shape the
 * response as `{ link, deduped }`. Factored out once the two routes'
 * handlers were near-identical copies and tripped jscpd's duplication gate
 * (`pnpm quality`'s `dupes` check, `.jscpd.json`'s 1.5% threshold) — the ONLY
 * difference between the two call sites is what goes into `input`
 * (`ingest.ts` may set `input.sourceData`, `links-write.ts` never does,
 * since the public capture body has no such field to read from). That
 * difference is the caller's job: this helper takes an already-built
 * `CreateLinkInput`, not a raw request body, so it stays agnostic to which
 * route's Zod schema produced it.
 *
 * `errorMessage` lets each caller keep its own wording for the "invalid
 * capture/ingest input" 400 body (mirrors the small wording difference the
 * two routes already had before this factor-out), without duplicating the
 * whole try/catch around it.
 */
export async function performCapture(
  c: Context,
  input: CreateLinkInput,
  errorMessage: string,
): Promise<Response> {
  const canon = canonicalize(input.url);
  if (!canon.ok) {
    return c.json(
      { error: 'invalid_url', message: 'Not a valid http(s) URL; nothing was saved.' },
      400,
    );
  }

  const deduped = await willDedupCapture(input.url);

  let created: Awaited<ReturnType<typeof createLink>>;
  try {
    created = await createLink(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { error: 'validation_error', message: errorMessage, details: error.issues },
        400,
      );
    }
    throw error;
  }

  const link = await getById(created.id);
  if (!link) {
    return c.json(
      { error: 'not_found', message: `Saved (id ${created.id}) but could not re-fetch it.` },
      404,
    );
  }
  return c.json({ link: toLinkJson(link), deduped }, 201);
}
