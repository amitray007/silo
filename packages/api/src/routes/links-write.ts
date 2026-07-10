import type { CreateLinkInput } from '@silo/core';
import { addTag, createTag, editLink, getById, removeTag } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  addTagBodySchema,
  captureBodySchema,
  createTagBodySchema,
  editBodySchema,
} from '../query-schemas.js';
import { performCapture, respondWithLink } from './mutate-link.js';

/** `POST /api/links/:id/tags` and `DELETE /api/links/:id/tags/:tag`'s shared `id` param schema — a non-uuid `id` is a 400, not a pointless DB round-trip. */
const idParamSchema = z.object({ id: z.uuid() });

/** `DELETE /api/links/:id/tags/:tag`'s param schema. */
const idTagParamSchema = z.object({ id: z.uuid(), tag: z.string().min(1) });

/**
 * Registers the A3 write routes (plan 007) over `core.createLink`/
 * `editLink`/`addTag`/`removeTag`/`createTag`. Mounted under `/api` by
 * `app.ts`, alongside the A2 read routes registered on the same sub-app in
 * `links.ts`. Every route follows: parse (Zod) -> [guard live via
 * `getById` where the core fn isn't live-scoped] -> one `core` call ->
 * `respondWithLink` (mutate-link.ts's shared re-fetch/shape/respond tail).
 */
export function registerLinksWriteRoutes(app: Hono): void {
  /**
   * `POST /api/links` — capture. Body: `url` (required), `tags?`, `note?`,
   * `sourceKind?` (defaults `'link'`), `source?` (capture-source slice — the
   * capture SURFACE, e.g. `'web'`; forwarded to `core.createLink` only when
   * present, never hardcoded here — omitted -> core defaults `'unknown'`).
   * Mirrors `capture_link`'s MCP handler (see `packages/mcp/server/src/
   * tools/capture-link.ts`):
   *
   * 1. Bad-URL guard via `canonicalize` — a `!ok` url (javascript:/data:/
   *    unparseable/over-length) is REJECTED here, before `core.createLink`
   *    ever runs, so nothing is saved for it (`core.createLink` would still
   *    store a rejected url, un-deduped, with an internal `#unsafe-<uuid>`
   *    canonical suffix — the edge guard exists specifically to stop that).
   * 2. `willDedupCapture` (best-effort, pre-create) to report an honest
   *    `deduped` flag on the response.
   * 3. `core.createLink({ ...body, origin: 'user' })` — web/API captures are
   *    USER origin (the `◆` mark is agent-only, set by the MCP tool's
   *    `origin: 'agent'`).
   * 4. A `ZodError` from `createLink` (an invalid `sourceKind`/`sourceData`
   *    combination — unreachable given the enum above, guarded anyway for
   *    parity with the MCP tool) maps to `400 validation_error`.
   * 5. Re-fetches (hydrates tags) and responds `201` with `{ link, deduped }`.
   *
   * Steps 1-5 are `performCapture` (`mutate-link.ts`) — shared with
   * `POST /api/ingest` (`ingest.ts`, plan 020), which builds the same kind of
   * `CreateLinkInput` but may additionally set `sourceData` (this route's
   * body schema has no such field, so `input` here never carries one).
   */
  app.post('/links', async (c) => {
    const body = captureBodySchema.parse(await c.req.json());

    // Built conditionally, not via object-literal spread: `exactOptionalPropertyTypes`
    // makes `CreateLinkInput`'s optional fields reject an explicit `undefined`,
    // and Zod's `.optional()` fields come through as `undefined` when the body
    // field is omitted (mirrors `capture-link.ts`'s MCP handler, which hits the
    // exact same constraint).
    const input: CreateLinkInput = {
      url: body.url,
      sourceKind: body.sourceKind ?? 'link',
      origin: 'user',
    };
    if (body.tags !== undefined) input.tags = body.tags;
    if (body.note !== undefined) input.notes = body.note;
    // Capture-source slice: forward only when the caller sent one — never
    // hardcode `'web'` here. `core.createLink` defaults omitted `source` to
    // `'unknown'`, which is honest for a bare/legacy caller of this route;
    // the web app itself sends `source: 'web'` explicitly (see the web
    // capture hook), it does not rely on a route-level default.
    if (body.source !== undefined) input.source = body.source;

    return performCapture(c, input, 'Invalid capture input');
  });

  /**
   * `PATCH /api/links/:id` — edit. Body: `{ title?, description?, note? }`,
   * all optional (an empty body is a valid no-op that returns the current
   * link — mirrors `core.editLink`'s own empty-patch branch). `core.editLink`
   * IS live-scoped (`whereLive`), so an unknown OR trashed id returns `null`
   * -> `404 not_found` directly, no separate guard needed.
   */
  app.patch('/links/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = editBodySchema.parse(await c.req.json().catch(() => ({})));

    const patch: { title?: string; description?: string; notes?: string } = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.note !== undefined) patch.notes = body.note;

    const updated = await editLink(id, patch);
    if (!updated) {
      return c.json({ error: 'not_found', message: `No live link with id ${id}` }, 404);
    }
    return respondWithLink(c, id, 200);
  });

  /**
   * `POST /api/links/:id/tags` — add tag. Body: `{ tag }`. `core.addTag` is
   * NOT live-scoped (see `add-tag.ts`'s MCP doc comment) — it would FK-throw
   * on a bogus id or silently tag an already-trashed link — so `getById` is
   * called FIRST as an explicit live-scope guard, same as the MCP tool.
   */
  app.post('/links/:id/tags', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = addTagBodySchema.parse(await c.req.json());

    const existing = await getById(id);
    if (!existing) {
      return c.json(
        { error: 'not_found', message: `No live link with id ${id} (unknown or trashed)` },
        404,
      );
    }

    await addTag(id, body.tag);
    return respondWithLink(c, id, 200);
  });

  /**
   * `DELETE /api/links/:id/tags/:tag` — remove tag. `core.removeTag` is also
   * NOT live-scoped — same `getById` guard as add-tag above. Removing an
   * absent tag (or one already removed) is a no-op 200, matching
   * `core.removeTag`'s own idempotent behavior.
   */
  app.delete('/links/:id/tags/:tag', async (c) => {
    const { id, tag } = idTagParamSchema.parse({ id: c.req.param('id'), tag: c.req.param('tag') });

    const existing = await getById(id);
    if (!existing) {
      return c.json(
        { error: 'not_found', message: `No live link with id ${id} (unknown or trashed)` },
        404,
      );
    }

    await removeTag(id, tag);
    return respondWithLink(c, id, 200);
  });

  /**
   * `POST /api/tags` — standalone create-tag (the mockup's "+ new tag").
   * `core.createTag` is idempotent + case-insensitive (W1: `AI` then `ai`
   * resolve to one row) and returns the CANONICAL display name (the
   * first-entered casing) or `null` for a blank/whitespace-only name — the
   * `min(1)` Zod check on `name` prevents an empty string, but a
   * whitespace-only name (e.g. `"   "`) still passes that check and reaches
   * `core.createTag`, which is what can return `null`; guarded as a 400
   * rather than asserted away.
   */
  app.post('/tags', async (c) => {
    const body = createTagBodySchema.parse(await c.req.json());
    const name = await createTag(body.name);
    if (name === null) {
      return c.json({ error: 'validation_error', message: 'Tag name must not be blank' }, 400);
    }
    return c.json({ name }, 201);
  });
}
