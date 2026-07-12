# Delete a tag (web + MCP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "delete a tag" operation — removes the tag and unlinks it from every link (links kept) — exposed as a web button on the tag page and a `delete_tag` MCP tool.

**Architecture:** One `core.deleteTag(name)` deletes the `tags` row; the `link_tags.tag_id` FK's `ON DELETE cascade` auto-removes associations while leaving links. A `DELETE /api/tags/:name` route, a `delete_tag` MCP tool, and a web `useDeleteTag()` hook + `DeleteTagButton` (two-step in-button confirm, then navigate away) all call that one function.

**Tech Stack:** TypeScript, Drizzle, Hono, MCP SDK, React + react-router, TanStack Query, Vitest.

## Global Constraints

- **Semantics are exact:** deleting a tag deletes the `tags` row + (via cascade) its
  `link_tags` rows ONLY. Links are never deleted. Case-insensitive match on
  `normalizeTagKey(name)`.
- **Naming — never conflate** `delete_tag` (destroy a tag everywhere, tag-scoped, NEW) with
  `remove_tag` (detach from ONE link, link-scoped, existing). Core: `deleteTag(name)` vs
  `removeTag(linkId, tagName)`. The `delete_tag` MCP description must lead with this contrast;
  `remove_tag` gets a reciprocal pointer.
- **Idempotent DELETE:** deleting a non-existent tag is success (`false` / `{deleted:false}` /
  200), not an error/404.
- **Architecture boundary:** `@silo/db` must not import `@silo/core`; `@silo/web` hand-mirrors
  types (no `@silo/core` import). Web `SettingsMap`-style discipline applies to any new type.
- **Design tokens only** (Oat ramp, Geist); reuse `HeaderActionButton` + `TrashIcon`/`CheckIcon`
  from `NavIcons.tsx`. No new asset.
- **Commit trailer** on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.
  Branch: `feat/delete-tag` (off main; never commit to `main`).
- **Done-gate:** `pnpm turbo run check-types test` + `pnpm quality` green. Local DB:
  `DATABASE_URL=postgres://maverick@localhost:5432/silo` (native Postgres on 5432).

---

### Task 1: Core — `deleteTag(name)`

**Files:**
- Modify: `packages/core/src/links/tags.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/links/tags.test.ts` (confirmed to exist — the tag core test file)

**Interfaces:**
- Consumes: `normalizeTagKey` (from `./links.js`), the `tags`/`linkTags`/`links` drizzle tables.
- Produces: `export async function deleteTag(name: string): Promise<boolean>` — `true` if a tag
  matched and was deleted, `false` if no tag matched.

- [ ] **Step 1: Write the failing tests**

Add to the tag test file (mirror the existing `createTag`/`listTagsWithCounts` integration test
setup in that file — it uses a real Postgres via the disposable-db harness; copy its
`beforeAll`/`describeIfPg` shape). Tests:

```ts
it('deleteTag removes the tag and its link associations but keeps the links', async () => {
  // Arrange: create two links, tag both with 'work', one also with 'keep'.
  const a = await createLink({ url: 'https://a.example', sourceKind: 'link' });
  const b = await createLink({ url: 'https://b.example', sourceKind: 'link' });
  await addTag(a.id, 'work');
  await addTag(b.id, 'work');
  await addTag(b.id, 'keep');

  const deleted = await deleteTag('work');

  expect(deleted).toBe(true);
  // Both links still exist and are live.
  expect(await getById(a.id)).not.toBeNull();
  expect(await getById(b.id)).not.toBeNull();
  // 'work' is gone from both links; 'keep' survives on b.
  expect((await getById(a.id))?.tags ?? []).not.toContain('work');
  expect((await getById(b.id))?.tags ?? []).toEqual(['keep']);
  // The tag no longer appears in the tag list.
  expect((await listTagsWithCounts()).map((t) => t.name)).not.toContain('work');
});

it('deleteTag is case-insensitive', async () => {
  const a = await createLink({ url: 'https://c.example', sourceKind: 'link' });
  await addTag(a.id, 'AI');
  expect(await deleteTag('ai')).toBe(true); // lowercase deletes the 'AI'-cased tag
  expect((await getById(a.id))?.tags ?? []).not.toContain('AI');
});

it('deleteTag returns false for a tag that does not exist (idempotent, not an error)', async () => {
  expect(await deleteTag('does-not-exist-xyz')).toBe(false);
});
```

Use the actual create/get helpers the test file already imports (likely `createLink`/`getById`
from `@silo/core` or the module under test) — match its existing imports.

- [ ] **Step 2: Run the tests — verify they fail**

Run: `DATABASE_URL=postgres://maverick@localhost:5432/silo pnpm --filter @silo/core test -- tags`
Expected: FAIL ("deleteTag is not a function" / import error).

- [ ] **Step 3: Implement `deleteTag`**

In `packages/core/src/links/tags.ts`, add (after `createTag`):

```ts
/**
 * Deletes a tag from the ENTIRE library: removes the `tags` row matched by
 * `normalizeTagKey(name)` (case-insensitive, same key `createTag`/`addTag`/
 * `removeTag` use). The `link_tags.tag_id` FK is `ON DELETE cascade`, so every
 * association row for this tag is removed in the same statement — but the
 * `links` themselves are NOT touched (the cascade flows tag -> link_tags only,
 * never link_tags -> links). Returns `true` if a tag was found and deleted,
 * `false` if no tag matched (idempotent: deleting an absent tag is a no-op
 * success, not an error).
 *
 * DISTINCT from `removeTag(linkId, tagName)` (in `links.ts`), which detaches a
 * tag from ONE specific link and leaves the tag itself intact for its other
 * links. `deleteTag` destroys the tag for every link at once.
 */
export async function deleteTag(name: string): Promise<boolean> {
  const normalizedKey = normalizeTagKey(name);
  if (!normalizedKey) return false;
  const result = await db.delete(tags).where(eq(tags.normalizedKey, normalizedKey)).returning({
    id: tags.id,
  });
  return result.length > 0;
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, add `deleteTag` to the export that already lists `createTag`/
`listTagsWithCounts` (find the line exporting `createTag` from `./links/tags.js` and add
`deleteTag`).

- [ ] **Step 5: Run the tests — verify they pass**

Run: `DATABASE_URL=postgres://maverick@localhost:5432/silo pnpm --filter @silo/core test -- tags`
Expected: PASS. Also `pnpm --filter @silo/core check-types` PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/links/tags.ts packages/core/src/index.ts packages/core/src/links/tags.test.ts
git commit -m "feat(core): deleteTag — remove a tag library-wide, keep its links (cascade)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: API — `DELETE /api/tags/:name`

**Files:**
- Modify: `packages/api/src/routes/links-write.ts`, `packages/api/src/query-schemas.ts`
- Test: `packages/api/src/routes/links-write.test.ts` (confirmed — where `POST /api/tags` + the
  per-link tag routes are tested; the `DELETE /api/tags/:name` test goes here, NOT in `tags.test.ts`
  which only covers `GET /api/tags`)

**Interfaces:**
- Consumes: `core.deleteTag` (Task 1).
- Produces: `DELETE /api/tags/:name` → `200 { deleted: boolean }`.

**Notes:** `links-write.ts` already imports the tag core fns and owns `POST /api/tags` +
`DELETE /api/links/:id/tags/:tag`. The `:name` param arrives URL-encoded (the client will
`encodeURIComponent` it) — Hono's `c.req.param('name')` returns it already decoded, so just
Zod-validate it.

- [ ] **Step 1: Add the param schema**

In `packages/api/src/query-schemas.ts`, add:

```ts
/** `DELETE /api/tags/:name` param — the tag to delete library-wide (min 1 char). */
export const tagNameParamSchema = z.object({ name: z.string().min(1) });
```

- [ ] **Step 2: Add the route**

In `packages/api/src/routes/links-write.ts`, import `deleteTag` (add to the existing
`@silo/core` import) and `tagNameParamSchema` (from `../query-schemas.js`), then add after the
`POST /tags` route:

```ts
  /**
   * `DELETE /api/tags/:name` — delete a tag from the ENTIRE library
   * (`core.deleteTag`): removes the tag + its link associations, keeping the
   * links. Case-insensitive. Idempotent: deleting a tag that doesn't exist
   * returns `200 { deleted: false }` (not 404) — a DELETE asking to remove
   * something already gone has succeeded. DISTINCT from
   * `DELETE /api/links/:id/tags/:tag` above, which only detaches a tag from ONE
   * link.
   */
  app.delete('/tags/:name', async (c) => {
    const { name } = tagNameParamSchema.parse({ name: c.req.param('name') });
    const deleted = await deleteTag(name);
    return c.json({ deleted }, 200);
  });
```

- [ ] **Step 3: Write the API test**

In the API tag-route test file, mirror the existing `POST /api/tags` / `DELETE /links/:id/tags`
tests (they use the disposable-db harness + a `createApp()` helper). Add:

```ts
it('DELETE /api/tags/:name deletes the tag library-wide and keeps the links (200 { deleted: true })', async () => {
  const { app } = harness.mod(); // match the file's harness accessor
  // seed: capture a link, tag it 'work' (use the same POST helpers the other tests use)
  // ...capture + POST /api/links/:id/tags { tag: 'work' }
  const res = await app.request('/api/tags/work', { method: 'DELETE' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });
  // GET /api/tags no longer lists 'work'; the link still exists (GET it, assert tags has no 'work')
});

it('DELETE /api/tags/:name for a missing tag returns 200 { deleted: false } (idempotent)', async () => {
  const { app } = harness.mod();
  const res = await app.request('/api/tags/nope-xyz', { method: 'DELETE' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: false });
});
```

Adapt the seeding + `harness` accessor to the file's actual conventions (read the existing
`POST /api/tags` test in the same file first and copy its shape exactly).

- [ ] **Step 4: Typecheck + test**

Run: `DATABASE_URL=... pnpm --filter @silo/api check-types && DATABASE_URL=... pnpm --filter @silo/api test -- tags` (or the test file's name)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/links-write.ts packages/api/src/query-schemas.ts packages/api/src/routes/<the test file>
git commit -m "feat(api): DELETE /api/tags/:name — delete a tag library-wide

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: MCP — `delete_tag` tool

**Files:**
- Create: `packages/mcp/server/src/tools/delete-tag.ts`
- Modify: `packages/mcp/server/src/server.ts`, `packages/mcp/server/src/tools/remove-tag.ts`
  (one cross-ref clause)
- Test: create `packages/mcp/server/src/tools/delete-tag.test.ts` (mirror
  `packages/mcp/server/src/tools/remove-tag.test.ts` — the confirmed sibling tag-tool test)

**Interfaces:**
- Consumes: `core.deleteTag`.
- Produces: an MCP tool `delete_tag` with `inputSchema { tag }`, `outputSchema { deleted, tag }`.

- [ ] **Step 1: Create the tool**

`packages/mcp/server/src/tools/delete-tag.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { deleteTag } from '@silo/core';
import { z } from 'zod';

const deleteTagOutputSchema = {
  deleted: z.boolean(),
  tag: z.string(),
};

/**
 * Registers `delete_tag`: delete a tag from the ENTIRE library via
 * `core.deleteTag`. No link to guard/re-fetch (unlike `remove_tag`) — one core
 * call, shape the result. Case-insensitive; idempotent (`deleted: false` if the
 * tag didn't exist, never an error).
 */
export function registerDeleteTag(server: McpServer): void {
  server.registerTool(
    'delete_tag',
    {
      title: 'Delete tag',
      description:
        'Delete a tag from the ENTIRE library — removes the tag and unlinks it ' +
        'from every link it was on. The links themselves are NOT deleted, only ' +
        'their association with this tag. Matching is case-insensitive ' +
        "(deleting 'ai' also deletes a tag stored as 'AI'). Idempotent: " +
        'deleting a tag that does not exist returns `deleted: false` (not an ' +
        'error). This is DIFFERENT from `remove_tag`, which only detaches a tag ' +
        'from ONE specific link and leaves the tag intact for its other links — ' +
        'use `remove_tag` for that, and `delete_tag` to get rid of a tag everywhere.',
      inputSchema: {
        tag: z
          .string()
          .min(1)
          .describe(
            'The tag to delete from the whole library (case-insensitive). Unlinks it from ' +
              'every link; the links are kept. Use remove_tag to detach a tag from just one link.',
          ),
      },
      outputSchema: deleteTagOutputSchema,
    },
    async ({ tag }): Promise<CallToolResult> => {
      const deleted = await deleteTag(tag);
      const text = deleted
        ? `Deleted tag '${tag}' from the library (removed from every link; the links are kept).`
        : `No tag '${tag}' exists — nothing to delete.`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { deleted, tag },
      };
    },
  );
}
```

- [ ] **Step 2: Wire it in `server.ts`**

In `packages/mcp/server/src/server.ts`: import `registerDeleteTag` (next to `registerRemoveTag`)
and call `registerDeleteTag(server)` right after `registerRemoveTag(server)`.

- [ ] **Step 3: Cross-reference from `remove_tag`**

In `packages/mcp/server/src/tools/remove-tag.ts`, append one clause to the `description` string
(after the existing text): `' To delete a tag from EVERY link at once (not just this one), use delete_tag instead.'`

- [ ] **Step 4: Write the MCP tool test**

In the MCP tag-tool test file, mirror the `remove_tag` tests. Add: `delete_tag` on an existing
tag returns `structuredContent: { deleted: true, tag }` and the tag is gone (assert via a
follow-up `list_links`/`get_link` or the core state); `delete_tag` on a missing tag returns
`{ deleted: false, tag }` with no error. Match the file's harness/registration test pattern.

- [ ] **Step 5: Typecheck + test**

Run: `DATABASE_URL=... pnpm --filter @silo/mcp-server check-types && DATABASE_URL=... pnpm --filter @silo/mcp-server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/server/src/tools/delete-tag.ts packages/mcp/server/src/server.ts packages/mcp/server/src/tools/remove-tag.ts packages/mcp/server/src/<test file>
git commit -m "feat(mcp): delete_tag tool — delete a tag library-wide (distinct from remove_tag)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Web — `useDeleteTag()` hook

**Files:**
- Modify: `packages/web/src/api/hooks.ts`

**Interfaces:**
- Consumes: `apiDelete` (from `./client`), `queryKeys`.
- Produces: `useDeleteTag()` — a mutation `(name: string) => apiDelete('/api/tags/:name')` that
  invalidates the tag list, link feeds, tag-only lists, and counts.

- [ ] **Step 1: Add the hook**

In `packages/web/src/api/hooks.ts`, after `useCreateTag`:

```ts
/**
 * Delete a tag from the ENTIRE library (`DELETE /api/tags/:name`) — removes the
 * tag and unlinks it from every link, keeping the links. Mirrors `useCreateTag`
 * but invalidates more: a deleted tag vanishes from the sidebar tag list
 * (`tags`), changes the tag set of every affected link (`links` /
 * `links-tag-only`), and shifts counts. Distinct from `useRemoveTag`, which
 * detaches a tag from one link.
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiDelete(`/api/tags/${encodeURIComponent(name)}`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: ['links-tag-only'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.counts() });
    },
  });
}
```

Confirm `apiDelete`'s signature (it's already imported at hooks.ts:8) — if it needs a type
param, use `apiDelete<{ deleted: boolean }>(...)`. Check how `useRemoveTag` calls `apiDelete`
and match it.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @silo/web check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/hooks.ts
git commit -m "feat(web): useDeleteTag hook

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Web — `DeleteTagButton` on the tag page (two-step confirm + navigate away)

**Files:**
- Modify: `packages/web/src/routes/TagView.tsx`
- Test: `packages/web/src/routes/TagView.test.tsx` (create if absent) OR add to an existing
  TagView/route test — check for one first.

**Interfaces:**
- Consumes: `useDeleteTag` (Task 4), `HeaderActionButton`, `TrashIcon`/`CheckIcon` (NavIcons),
  `useNavigate` (react-router).
- Produces: a Delete button in `TagView`'s `headerSlot`, beside `PasteCaptureButton`.

**Pattern:** mirror `TrashView.tsx`'s `TrashEmptyNowButton` two-step in-button confirm EXACTLY
(trash icon + "Delete" → first click → check icon + "Confirm?" → second click deletes; auto-reset
after 4s; `isPending` disables). No `window.confirm`.

- [ ] **Step 1: Add `DeleteTagButton` and place it in the header**

In `packages/web/src/routes/TagView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDeleteTag } from '../api/hooks';
import { CheckIcon, TrashIcon } from '../components/NavIcons';
import { HeaderActionButton } from '../components/HeaderActionButton';
// ...existing imports (PasteCaptureButton, ListBody, ContentFrame, EmptyState, useListView)

/** Confirm-state auto-reset (mirrors TrashView's CONFIRM_RESET_MS). */
const CONFIRM_RESET_MS = 4000;

/**
 * The tag page's "Delete" button — the SAME two-step in-button confirm as
 * `TrashView`'s `TrashEmptyNowButton` (trash icon + "Delete" → first click →
 * check icon + "Confirm?" → second click deletes). Deleting a tag removes it
 * from EVERY link (the links are kept) and is not undoable, so a single tap
 * must never fire it. On success, navigates to the Library (`/`) since this
 * tag's page would otherwise show a dead/empty feed.
 */
function DeleteTagButton({ tag }: { tag: string }) {
  const deleteTag = useDeleteTag();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  function armConfirm() {
    setConfirming(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setConfirming(false), CONFIRM_RESET_MS);
  }

  function handleClick(): undefined {
    if (!confirming) {
      armConfirm();
      return undefined;
    }
    clearTimeout(resetTimer.current);
    deleteTag.mutate(tag, {
      onSuccess: () => navigate('/'),
      onSettled: () => setConfirming(false),
    });
    return undefined;
  }

  return (
    <HeaderActionButton
      icon={confirming ? <CheckIcon /> : <TrashIcon size={16} stroke="currentColor" />}
      label={confirming ? 'Confirm?' : 'Delete'}
      onClick={handleClick}
      disabled={deleteTag.isPending || !tag}
      title={
        confirming
          ? `Confirm deleting the tag "${tag}" from all links`
          : `Delete the tag "${tag}" (removes it from all links; the links are kept)`
      }
      ariaLabel={confirming ? 'Confirm deleting this tag' : 'Delete this tag'}
    />
  );
}
```

Then update the `headerSlot` (destructive action to the LEFT of the primary "Add", a common
convention):

```tsx
      headerSlot={
        <>
          <DeleteTagButton tag={tag} />
          <PasteCaptureButton tags={[tag]} />
        </>
      }
```

(Verify `ContentHeader`'s right slot lays multiple children in a row with a gap — it renders
`children` after a `flex:1` spacer; if they don't already gap, wrap them in a
`<span style={{ display: 'flex', gap: 'var(--s2)' }}>`. Check `ContentHeader.tsx` and match how
any existing multi-button header does it; the Library/Trash headers have a single button, so a
gap wrapper is likely needed.)

- [ ] **Step 2: Test (component)**

If a route-test harness exists for TagView (check `packages/web/src/routes/*.test.tsx` and how
LibraryView/TrashView are tested), add a test: rendering `TagView` for a tag shows a "Delete"
button; clicking it once shows "Confirm?"; a second click calls the delete mutation (mock
`fetch`/the hook) and navigates. If the route-test harness is heavy, at minimum add a focused
test of `DeleteTagButton`'s two-click behavior mirroring how `TrashEmptyNowButton` is tested (find
that test: `grep -rn "Empty Now\|Confirm?" packages/web/src/**/*.test.tsx`). If neither exists,
note that the button behavior is covered by browser QA (Task 6) and add the smallest sensible
unit test you can.

- [ ] **Step 3: Typecheck + lint + web test**

Run: `pnpm --filter @silo/web check-types && npx biome check packages/web/src/routes/TagView.tsx && pnpm --filter @silo/web test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/TagView.tsx packages/web/src/routes/TagView.test.tsx
git commit -m "feat(web): delete-tag button on the tag page (two-step confirm, navigates away)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Whole-tree gate + browser QA

- [ ] **Step 1: Whole-tree gate**

Run: `DATABASE_URL=postgres://maverick@localhost:5432/silo pnpm turbo run check-types test` + `pnpm quality`
Expected: GREEN.

- [ ] **Step 2: Browser QA (orchestrator does this)**

Bring up the app + Postgres. Seed a tag on 2 links via the API (`POST /api/links` then
`POST /api/links/:id/tags {tag}`), open `/tags/<name>`:
- The header shows "Delete" beside "Add".
- Click Delete → it flips to "✓ Confirm?"; wait >4s → it resets to "Delete" (auto-reset).
- Click Delete → Confirm? → the tag vanishes from the sidebar, the app navigates to `/`
  (Library), and both links still exist in the Library **without** that tag.
- Verify the MCP/API path directly: `DELETE /api/tags/<name>` returns `{deleted:true}` for an
  existing tag and `{deleted:false}` for a missing one; the links survive.
- Capture before/after screenshots.

- [ ] **Step 3: Clean up seeded QA data + restore state.**
