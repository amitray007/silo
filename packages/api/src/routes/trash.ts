import {
  emptyTrash,
  getById,
  hardDelete,
  listTrash,
  requestRetry,
  restore,
  softDelete,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { toLinkJson, toTrashLinkJson } from '../link-json.js';
import { pageQuerySchema, toPageParams } from '../query-schemas.js';
import { respondWithLink } from './mutate-link.js';

/** Shared `id` param schema for the single-link lifecycle routes below — a non-uuid `id` is a 400, not a pointless DB round-trip. */
const idParamSchema = z.object({ id: z.uuid() });

/**
 * Registers the A2 trash-READ route (`GET /api/trash`) and the A4
 * trash/lifecycle WRITE routes (plan 007) over `core.listTrash` (C2) /
 * `softDelete` / `restore` / `requestRetry` / `hardDelete` / `emptyTrash`
 * (C3). Mounted under `/api` by `app.ts`, alongside the other route modules
 * registered on the same sub-app. Kept in one file (rather than a sibling
 * `trash-write.ts`) since every route here shares the same "trash" resource
 * and the file is still small — mirrors `links.ts` keeping its read routes
 * together rather than one-file-per-route.
 */
export function registerTrashRoutes(app: Hono): void {
  /**
   * `GET /api/trash` — the whole Trash screen's data (plan 007, A2). Backed by
   * `core.listTrash` (C2), the ONE read deliberately NOT scoped through
   * `whereLive` — see `trash.ts`'s doc comment in `@silo/core`. A `list`/
   * `search` cursor handed here throws `InvalidCursorError` (mismatched `kind`
   * tag), mapped by the app's `onError` to `400 invalid_cursor` same as any
   * other malformed cursor.
   */
  app.get('/trash', async (c) => {
    const query = pageQuerySchema.parse(c.req.query());
    const result = await listTrash(toPageParams(query));
    const links = result.links.map(toTrashLinkJson);
    return c.json(
      result.nextCursor === undefined ? { links } : { links, nextCursor: result.nextCursor },
    );
  });

  /**
   * `POST /api/links/:id/trash` — soft-delete (plan 007, A4). Mirrors
   * `trash_link`'s MCP handler (`packages/mcp/server/src/tools/trash-link.ts`):
   * `core.softDelete` is live-scoped and returns a BARE `Link | null` — never
   * `LinkWithTags` — and `null` covers BOTH an unknown id and an
   * already-trashed one (the query is `WHERE live AND id = ...`, so the two
   * cases can't be told apart; the 404 message says so honestly rather than
   * guessing which).
   *
   * On success, the row is now trashed — `getById` (live-scoped) could never
   * re-fetch it, so unlike every other write route this one does NOT call
   * `respondWithLink` (which re-fetches via `getById` and would always 404
   * here). Instead it shapes the response directly from the bare `deleted`
   * row via `toLinkJson`, with `tags` forced to `[]` — an honest omission
   * (the link is leaving the live set, so its tag list isn't hydrated),
   * exactly like `trash_link`'s `structuredContent` does.
   */
  app.post('/links/:id/trash', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });

    const deleted = await softDelete(id);
    if (!deleted) {
      return c.json(
        {
          error: 'not_found',
          message: `No live link with id ${id} to trash — it's either unknown or already in the trash.`,
        },
        404,
      );
    }

    // `toLinkJson` expects a `LinkWithTags`; `deleted` is a bare `Link` (no
    // `tags` field at all). Built as a `LinkWithTags` with `tags: []` — same
    // honest-omission shape `trash_link`'s MCP tool returns — rather than
    // giving `toLinkJson` a wider input type just for this one caller.
    return c.json({ link: toLinkJson({ ...deleted, tags: [] }) }, 200);
  });

  /**
   * `POST /api/links/:id/restore` — restore from trash (plan 007, A4).
   * Mirrors `restore_link`'s MCP handler (`restore-link.ts`): `core.restore`
   * returns a discriminated `RestoreResult` with THREE cases, not a plain
   * found/not-found boolean — `merged` needs its own honest handling because
   * the returned link's id can differ from the id requested.
   *
   * - `not_found` -> 404 (unknown id, or not currently in trash — e.g.
   *   already live).
   * - `restored`/`merged` -> both return a bare `Link` (no `tags`); re-fetch
   *   via `getById` to hydrate tags before shaping, same pattern every other
   *   write route uses.
   * - `merged` specifically: the trashed row collided on `canonical_url`
   *   with an already-live row, so its notes/tags were folded into that
   *   EXISTING live link instead — the response's `link.id` is that OTHER,
   *   already-live id, not the id requested. The message says this
   *   explicitly (both ids), matching `restore_link`'s doc-comment rationale:
   *   silently returning a link under a different id than requested, without
   *   calling it out, would be a non-actionable result.
   */
  app.post('/links/:id/restore', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });

    const result = await restore(id);
    if (result.status === 'not_found') {
      return c.json(
        {
          outcome: 'not_found',
          error: 'not_found',
          message: `Nothing to restore for id ${id} — it's unknown or not in the trash (it may already be live).`,
        },
        404,
      );
    }

    const link = await getById(result.link.id);
    if (!link) {
      return c.json(
        {
          error: 'not_found',
          message: `Restored link ${id} but could not re-fetch it immediately after (tried id ${result.link.id}).`,
        },
        404,
      );
    }

    if (result.status === 'merged') {
      return c.json(
        {
          outcome: 'merged',
          link: toLinkJson(link),
          message:
            `The link you restored was merged into an existing live link (id ${result.link.id}) ` +
            `that already had the same URL — its notes and tags were folded in. The original id ` +
            `${id} no longer exists as a live link; use id ${result.link.id} going forward.`,
        },
        200,
      );
    }

    return c.json({ outcome: 'restored', link: toLinkJson(link) }, 200);
  });

  /**
   * `POST /api/links/:id/retry` — retry a degraded capture (plan 007, A4).
   * Mirrors `retry_capture`'s MCP handler (`retry-capture.ts`): `core.
   * requestRetry` resets a LIVE, retryable link (`partial`/`bare`/stuck
   * `enriching`) back to `enriching`; a `full` (already-good) capture, an
   * unknown id, or a trashed one all return `null` (a good capture is never
   * downgraded by a retry — same honest not-retryable message as the MCP tool).
   */
  app.post('/links/:id/retry', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });

    const retried = await requestRetry(id);
    if (!retried) {
      return c.json(
        {
          error: 'not_found',
          message: `Could not retry link ${id} — it's either unknown, trashed, or already fully captured (status 'full', nothing to retry).`,
        },
        404,
      );
    }

    return respondWithLink(c, id, 200);
  });

  /**
   * `DELETE /api/trash/:id` — hard-delete ONE trashed link (plan 007, A4;
   * "delete now"). `core.hardDelete` (C3) is a TRASHED-ONLY atomic guard: its
   * own `DELETE ... WHERE id = ... AND deleted_at IS NOT NULL` can never match
   * a live row, so handing it a live link's id is a no-op — `false` — and
   * that live row is left completely untouched. `false` also covers an
   * unknown id. Both collapse to the same honest 404 (the guard's whole point
   * is that "wrong id" and "not trashed" are equally safe outcomes — neither
   * ever deletes a live link). Success is `204 No Content` — a destructive
   * delete with nothing left to return.
   */
  app.delete('/trash/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });

    const deleted = await hardDelete(id);
    if (!deleted) {
      return c.json(
        {
          error: 'not_found',
          message: `No TRASHED link with id ${id} to delete — it's either unknown or still live (hard-delete never touches a live link).`,
        },
        404,
      );
    }

    return c.body(null, 204);
  });

  /**
   * `DELETE /api/trash` — empty the whole trash (plan 007, A4; "empty now").
   * `core.emptyTrash` (C3) hard-deletes every currently-trashed link
   * regardless of age (distinct from the age-gated `purgeTrash` sweep) — its
   * own `DELETE ... WHERE deleted_at IS NOT NULL` predicate means a live link
   * can never be matched, same guard discipline as `hardDelete`. Returns
   * `200 { deleted: number }` (not 204 — the count is exactly the useful
   * confirmation an "empty now" action needs).
   */
  app.delete('/trash', async (c) => {
    const deleted = await emptyTrash();
    return c.json({ deleted }, 200);
  });
}
