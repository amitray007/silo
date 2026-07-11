import {
  emptyTrash,
  getById,
  hardDelete,
  listTrash,
  requestRetry,
  restore,
  restoreMany,
  retryCaptureMany,
  searchTrash,
  softDelete,
  trashMany,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { runBulkGuarded } from '../bulk-result.js';
import { toLinkJson, toTrashLinkJson, toTrashSnippetSearchResultJson } from '../link-json.js';
import { batchIdsBodySchema, pageQuerySchema, toPageParams } from '../query-schemas.js';
import { respondWithLink } from './mutate-link.js';

/** Shared `id` param schema for the single-link lifecycle routes below — a non-uuid `id` is a 400, not a pointless DB round-trip. */
const idParamSchema = z.object({ id: z.uuid() });

/** `GET /api/trash/search` query schema — identical shape to `/links/search`'s: `q` is required (min length 1) so an empty/missing query is a 400, not a full unfiltered scan. */
const trashSearchQuerySchema = pageQuerySchema.extend({
  q: z.string().min(1),
});

/**
 * Registers the A2 trash-READ routes (`GET /api/trash`, `GET
 * /api/trash/search` — the latter added by the Trash search slice) and the
 * A4 trash/lifecycle WRITE routes (plan 007) over `core.listTrash` (C2) /
 * `core.searchTrash` / `softDelete` / `restore` / `requestRetry` /
 * `hardDelete` / `emptyTrash` (C3). Mounted under `/api` by `app.ts`,
 * alongside the other route modules registered on the same sub-app. Kept in
 * one file (rather than a sibling `trash-write.ts`) since every route here
 * shares the same "trash" resource and the file is still small — mirrors
 * `links.ts` keeping its read routes together rather than one-file-per-route.
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
   * `GET /api/trash/search` — server-side full-text search scoped to TRASHED
   * links (Trash search slice), mirroring `GET /api/links/search`: same
   * `searchQuerySchema` shape (`q` required, min length 1 -> 400 on
   * empty/missing), same envelope (`{ results, nextCursor? }`). Backed by
   * `core.searchTrash` instead of `core.search` — the only difference is
   * which live/trash predicate the query runs under; `core.searchTrash`
   * ALSO returns `SearchResultRow[]` (U2's snippet-not-extractedText shape —
   * see `link-json.ts`'s `TrashSnippetSearchResultJson` doc comment), so its
   * result rows carry `snippet` + `deletedAt` + `rank`, matching live
   * search's own `extractedText` drop. Registered before any `/trash/:id`-
   * shaped route would matter for route-ordering (there is none on GET today
   * — see `app.ts`'s route list — but this keeps the same "literal segment
   * before :id" discipline `links.ts` documents for `/links/search` vs
   * `/links/:id`, in case a `GET /trash/:id` is ever added).
   */
  app.get('/trash/search', async (c) => {
    const query = trashSearchQuerySchema.parse(c.req.query());
    const result = await searchTrash(query.q, toPageParams(query));
    const results = result.results.map(toTrashSnippetSearchResultJson);
    return c.json(
      result.nextCursor === undefined ? { results } : { results, nextCursor: result.nextCursor },
    );
  });

  /**
   * `POST /api/links/batch/trash`, `POST /api/links/batch/restore`,
   * `POST /api/links/batch/retry` (agent-navigation slice U5) — registered
   * BEFORE `POST /links/:id/trash|restore|retry` below for the SAME route-
   * ordering reason `links.ts` documents for `/links/search` vs `/links/:id`:
   * Hono matches the FIRST registered handler for a path, and `:id` has no
   * inherent priority over a literal `batch` segment — if `/links/:id/trash`
   * were registered first, a request to `/links/batch/trash` would match
   * `:id = "batch"` (then fail `idParamSchema`'s `z.uuid()` as a confusing
   * `400 validation_error`, masking the batch route entirely). Proven by this
   * file's own route-ordering regression coverage below.
   */
  app.post('/links/batch/trash', async (c) => {
    const body = batchIdsBodySchema.parse(await c.req.json());
    const outcome = await runBulkGuarded(c, () => trashMany(body.ids));
    if (!outcome.ok) return outcome.response;
    return c.json({ results: outcome.value }, 200);
  });

  app.post('/links/batch/restore', async (c) => {
    const body = batchIdsBodySchema.parse(await c.req.json());
    const outcome = await runBulkGuarded(c, () => restoreMany(body.ids));
    if (!outcome.ok) return outcome.response;
    return c.json({ results: outcome.value }, 200);
  });

  app.post('/links/batch/retry', async (c) => {
    const body = batchIdsBodySchema.parse(await c.req.json());
    const outcome = await runBulkGuarded(c, () => retryCaptureMany(body.ids));
    if (!outcome.ok) return outcome.response;
    return c.json({ results: outcome.value }, 200);
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
