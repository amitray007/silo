# Delete a tag (web + MCP)

**Date:** 2026-07-12
**Surface:** core + api + mcp + web. A new library-level operation.
**Status:** design; ready for implementation plan.

## Problem

There is no way to delete a tag from the library. Silo can create tags, attach them to
links (`add_tag`), and detach them from a single link (`remove_tag`), but a tag that's no
longer wanted lingers forever — it can only be emptied link-by-link, and even then the
(now orphaned) tag row stays. The user wants a one-action "delete this tag" on the tag
page, and — per silo's agent-native rule — an agent must be able to do the same over MCP.

## Semantics (exact)

**Deleting a tag removes the tag and unlinks it from every link. The links themselves are
never deleted.** Mechanically this is a single `DELETE FROM tags WHERE id = ?`: the
`link_tags.tag_id` FK has `ON DELETE cascade` (verified: `link-tags.ts` + migration
`0001`), so removing the tag row auto-removes all its `link_tags` association rows in the
same statement, transactionally. The cascade flows tag → link_tags only, never
link_tags → links, so links are untouched — exactly the intended behavior.

## Naming — the critical distinction (user-flagged)

Two operations must never be confused:

| Operation | Scope | Name |
|---|---|---|
| Detach a tag from ONE link | link-scoped (existing) | `remove_tag` / `core.removeTag(linkId, tagName)` / `DELETE /api/links/:id/tags/:tag` |
| Destroy a tag EVERYWHERE | tag-scoped (new) | `delete_tag` / `core.deleteTag(name)` / `DELETE /api/tags/:name` |

- The core signatures alone disambiguate: `removeTag(linkId, tagName)` takes a link;
  `deleteTag(name)` takes only a tag name.
- The MCP `delete_tag` tool's **description leads with the contrast**: "Deletes a tag
  entirely from the library — removes the tag and unlinks it from every link it was on.
  The links themselves are NOT deleted. Different from `remove_tag`, which only detaches a
  tag from ONE specific link." The `remove_tag` description will get a reciprocal one-line
  pointer to `delete_tag`.
- The web button tooltip: "Delete tag (removes it from all links; links are kept)".

## Design

### 1. Core — `deleteTag(name): Promise<boolean>`
`packages/core/src/links/tags.ts`, exported via `index.ts`. Look up the tag by
`normalizeTagKey(name)` (the same case-insensitive dedup key `addTag`/`removeTag` use);
if found, `db.delete(tags).where(eq(tags.id, tag.id))` and return `true`. If no tag
matches, return `false` (not an error — a caller asking to delete a non-existent tag has
already got what it wanted). The `link_tags` cascade needs no explicit handling. Matching
is case-insensitive, consistent with every other tag op.

### 2. API — `DELETE /api/tags/:name`
`packages/api/src/routes/links-write.ts` (which already owns tag writes and imports the
tag core fns). Mirrors the existing `DELETE /api/links/:id/tags/:tag` shape: parse the
`:name` param (URL-decoded) with a `z.object({ name: z.string().min(1) })` schema, call
`core.deleteTag(name)`, and respond `{ deleted: boolean }` (200). A `false` still returns
200 with `deleted: false` (idempotent DELETE — asking to delete something already gone is
success, not 404), which keeps the client simple. Add the param schema to
`query-schemas.ts` (or inline).

### 3. MCP — `delete_tag` tool
New `packages/mcp/server/src/tools/delete-tag.ts` exporting `registerDeleteTag`, wired in
`server.ts`. Follows the tool pattern (`registerTool` + Zod input/output). Simpler than
`remove_tag` — no link to guard/re-fetch:
- `inputSchema`: `{ tag: z.string().min(1).describe('The tag to delete from the entire library (case-insensitive). This unlinks it from every link; the links are NOT deleted. Use remove_tag to detach a tag from just ONE link.') }`
- Handler: `const deleted = await core.deleteTag(tag)`, return a text summary + `structuredContent: { deleted, tag }`.
- `outputSchema`: `{ deleted: z.boolean(), tag: z.string() }`.
- Register it in `server.ts` next to `registerRemoveTag`.
- The `remove_tag` description gains one clause pointing to `delete_tag` for the whole-library case.

### 4. Web — `useDeleteTag()` hook + Trash-bin button on the tag page
- **Hook** (`packages/web/src/api/hooks.ts`): `useDeleteTag()` mirrors `useCreateTag`,
  `mutationFn: (name) => apiDelete(\`/api/tags/${encodeURIComponent(name)}\`)`. On settle,
  invalidate `queryKeys.tags()` (sidebar list), `['links']`, `['links-tag-only']`, and
  `queryKeys.counts()` — a deleted tag changes affected links' tag sets and must vanish
  from the sidebar.
- **Button** (`packages/web/src/routes/TagView.tsx`): add a Trash-bin `HeaderActionButton`
  in the `headerSlot`, **beside** the existing `PasteCaptureButton` ("Add"), built on the
  same `HeaderActionButton` primitive for visual parity (icon + label, its built-in toast).
  Order: `headerSlot={<><DeleteTagButton name={tag} /><PasteCaptureButton tags={[tag]} /></>}`
  so Delete sits just before Add (or after — decide by visual balance in QA; a destructive
  action typically sits left of the primary). Label "Delete" with a trash icon.
- **Confirm + navigate:** deleting is destructive and not trivially undoable (the tag and
  all its associations are gone). Gate the click behind a lightweight confirm (reuse the
  app's existing confirm pattern if one exists — e.g. the row-menu "trash" confirm — else a
  simple `window.confirm` is acceptable for v1, matching the codebase's existing confirm
  affordances; the plan will check what exists). On success, `useNavigate()` away from
  `/tags/:name` to the library (`/`), since the tag page would otherwise show an empty/stale
  feed for a tag that no longer exists.
- **Trash icon:** use the same trash glyph the sidebar/Trash nav uses (design-token
  consistent, no new asset).

## Agent-native parity
The web "Delete tag" button and the `delete_tag` MCP tool share the one `core.deleteTag`
function — a user action and an agent action map to identical behavior, satisfying the
"any action a user can take, an agent can also take" rule.

## Non-goals
- No tag **rename** (separate feature; not requested).
- No soft-delete / undo of a tag (tags aren't soft-deleted; this is a hard delete, matching
  the schema's lack of a `deletedAt` on tags). If undo is wanted later, it's a follow-up.
- No bulk multi-tag delete (one tag at a time; the MCP tool could grow an `ids`/`tags` batch
  later like `remove_tag` did, but not now).
- No change to `remove_tag`/`add_tag` behavior beyond the one cross-referencing description
  clause.

## Files touched
- `packages/core/src/links/tags.ts` (+ `index.ts` export) — `deleteTag`.
- `packages/core/src/links/tags.test.ts` (or the tag test file) — core delete tests.
- `packages/api/src/routes/links-write.ts` — `DELETE /api/tags/:name`.
- `packages/api/src/query-schemas.ts` — the `:name` param schema.
- `packages/api/src/routes/…test` — API route test.
- `packages/mcp/server/src/tools/delete-tag.ts` (new) + `server.ts` — the tool.
- `packages/mcp/server/src/tools/remove-tag.ts` — one cross-ref clause in the description.
- `packages/mcp/server/src/…test` — MCP tool test.
- `packages/web/src/api/hooks.ts` — `useDeleteTag`.
- `packages/web/src/routes/TagView.tsx` (+ a small `DeleteTagButton`) — the header button.

## Verification
- **Gate:** `pnpm turbo run check-types test` + `pnpm quality` green.
- **Core/API/MCP tests:** deleting an existing tag returns true/`{deleted:true}` and removes
  the tag + its `link_tags` rows while leaving the links live (assert the links still exist
  and just lost that tag); deleting a non-existent tag returns false/`{deleted:false}` (no
  error); case-insensitive match ('AI' deletes a tag stored as 'ai').
- **Browser QA (real app + Postgres):** create a tag on a couple of links, open its tag
  page, click Delete → confirm → the tag disappears from the sidebar, the links still exist
  in the library (just without that tag), and the app navigates away from the dead tag page.
  Also verify the `delete_tag` MCP path via the API (`DELETE /api/tags/:name`) end-to-end.
