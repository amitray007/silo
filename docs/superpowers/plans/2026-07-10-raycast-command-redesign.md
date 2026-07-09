# Raycast command redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the silo Raycast extension the complete keyboard-first library surface: instant Save (closes Raycast, HUD), Save-with-Details, Search and Browse with a shared rich detail pane (favicon + images via silo's proxy), and every verb (edit, tag, trash, restore, retry) in the `⌘K` action panel — Trash as a Browse scope.

**Architecture:** Four commands, a small set of shared `lib/` units (typed API client, image-URL helpers, one detail component, one action panel, one tag picker) reused by Search and Browse so they render identically. Extension is a plain HTTP client — all state comes from the silo API; no `@silo/core`/`@silo/api` imports. AI-free.

**Tech Stack:** TypeScript + React (Raycast API), Vitest. `@raycast/api` is types-only (aliased in tests via `test-support/raycast-api-mock.ts` + per-file `vi.mock`). No new deps.

## Global Constraints

- **No `@silo/core`/`@silo/api` imports** (biome `noRestrictedImports`, `docs/rules/architecture.md`).
- **Privacy (binding):** every favicon/image loads from `${baseUrl}/api/favicon?domain=` or `${baseUrl}/api/preview-image?linkId=` — silo's proxy — NEVER the source host. Enforced through `lib/image-urls.ts` (single source of truth).
- Design "Oat" (`docs/design/tokens.md`): amber is a mark, never a fill; sentence case; the `◌ capturing` accessory only while `enriching`.
- **Destructive actions** (trash / delete-permanently / empty-trash) never bind to `⏎`, use a distinct modifier, and `confirmAlert` first.
- All commands run from `extensions/raycast/`. Test: `pnpm --filter silo-raycast test`. Types: `pnpm --filter silo-raycast check-types`. Build: `pnpm --filter silo-raycast build`. Root gate: `pnpm turbo run check-types test --filter=silo-raycast && pnpm quality`.
- **Run Biome autofix before each commit:** `pnpm --filter silo-raycast exec biome check --write src` — formatting must never block the done-gate.
- TDD per task; commit by explicit path (never `git add -A`). Branch `feat/raycast-command-redesign` (already checked out). Never touch `main`.

## API contract (verified in `packages/api` — build against these)

- `POST /api/links { url, note?, tags? }` → `{ link, deduped }`
- `GET /api/links?tag=&status=&limit=&cursor=` → `{ links, nextCursor? }` (Browse)
- `GET /api/links/search?q=&tag=&limit=` → `{ results, nextCursor? }` (Search; `results` items carry `rank`)
- `GET /api/trash?limit=&cursor=` → `{ links, nextCursor? }` (each link has `deletedAt: string`)
- `GET /api/trash/search?q=` → `{ results }`
- `PATCH /api/links/:id { note }` → `{ link }` (replaces note)
- `POST /api/links/:id/tags { tag }` → `{ link }`; `DELETE /api/links/:id/tags/:tag` → `{ link }`
- `POST /api/links/:id/trash` → `{ link }`; `POST /api/links/:id/restore` → `{ link }`; `POST /api/links/:id/retry` → `{ link }`
- `DELETE /api/trash` → 204 (empty all); `DELETE /api/trash/:id` → 204 (delete one)
- `GET /api/tags` → `{ tags: { name, count }[] }`
- `GET /api/counts` → `{ ...counts, purgeWindowDays }`
- Images: `GET /api/preview-image?linkId=<id>`, `GET /api/favicon?domain=<host>` (both proxies; may 404 when absent)

## File structure

**Modify:** `src/lib/capture-client.ts`, `src/lib/types.ts`, `src/save-to-silo.ts`, `src/search-silo.tsx`, `package.json`.
**Create:** `src/lib/image-urls.ts`, `src/lib/link-detail.tsx`, `src/lib/link-actions.tsx`, `src/lib/tag-picker.tsx`, `src/browse-silo.tsx` (+ their `.test.ts(x)`).

---

### Task 1: Save closes Raycast after the HUD

**Files:** Modify `src/save-to-silo.ts`; Test `src/save-to-silo.test.ts`.

**Interfaces:** Consumes `closeMainWindow`, `popToRoot`, `showHUD` from `@raycast/api`. Produces the same command with a close+pop after the success/dedup HUD.

- [ ] **Step 1: Read `save-to-silo.ts` + its test** to see the current HUD flow and mock style (the test already mocks `@raycast/api` — extend it, don't rewrite).

- [ ] **Step 2: Add to the `@raycast/api` mock** in `save-to-silo.test.ts` (and `test-support/raycast-api-mock.ts` if shared): `closeMainWindow: vi.fn(async () => {})`, `popToRoot: vi.fn(async () => {})`, `PopToRootType: { Immediate: 'immediate' }`.

- [ ] **Step 3: Write the failing test** — assert that after a successful capture, `closeMainWindow` is called:

```ts
it('closes Raycast after a successful save', async () => {
  // arrange: mock captureLink -> { link, deduped:false }, resolve-url -> a url
  const api = await import('@raycast/api');
  await (await import('./save-to-silo.js')).default();
  expect(api.closeMainWindow).toHaveBeenCalled();
  expect(api.showHUD).toHaveBeenCalledWith(expect.stringContaining('Saved to silo'));
});
```

- [ ] **Step 4: Run → FAIL** (`closeMainWindow` not called). `pnpm --filter silo-raycast test -- save-to-silo`

- [ ] **Step 5: Implement** — in `save-to-silo.ts`, after the success/dedup `showHUD`, add `await closeMainWindow({ popToRootType: PopToRootType.Immediate })` (import it). On the error path, keep the current behavior (HUD error; the command still ends). Keep the message text: "Saved to silo" / "Already in silo (updated)".

- [ ] **Step 6: Run → PASS.** Biome autofix. Commit: `feat(raycast): Save closes Raycast after the confirming HUD`.

---

### Task 2: image-urls helpers (privacy proxy, single source of truth)

**Files:** Create `src/lib/image-urls.ts`, `src/lib/image-urls.test.ts`.

**Interfaces:**
- `faviconUrl(baseUrl: string, domain: string): string` → `${baseUrl}/api/favicon?domain=<encoded>`
- `previewImageUrl(baseUrl: string, linkId: string): string` → `${baseUrl}/api/preview-image?linkId=<encoded>`
- `domainOf(url: string): string` → hostname (for favicon lookups); returns `''` on unparseable.

- [ ] **Step 1: Write the failing test** — `src/lib/image-urls.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { domainOf, faviconUrl, previewImageUrl } from './image-urls.js';

describe('image-urls', () => {
  it('builds a proxied favicon url from baseUrl + domain', () => {
    expect(faviconUrl('http://localhost:8787', 'github.com')).toBe(
      'http://localhost:8787/api/favicon?domain=github.com',
    );
  });
  it('builds a proxied preview-image url', () => {
    expect(previewImageUrl('http://localhost:8787', 'abc 1')).toBe(
      'http://localhost:8787/api/preview-image?linkId=abc%201',
    );
  });
  it('extracts hostname, and empty string for garbage', () => {
    expect(domainOf('https://sub.example.com/x')).toBe('sub.example.com');
    expect(domainOf('not a url')).toBe('');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/lib/image-urls.ts`

```ts
/**
 * The ONLY place proxy image/favicon URLs are built. silo's privacy rule
 * ("no third-party calls per row") means the client must fetch images from
 * silo's own proxy, never the source host — centralizing the URL shape here
 * makes that impossible to get wrong per-call.
 */
export function faviconUrl(baseUrl: string, domain: string): string {
  return `${baseUrl}/api/favicon?domain=${encodeURIComponent(domain)}`;
}

export function previewImageUrl(baseUrl: string, linkId: string): string {
  return `${baseUrl}/api/preview-image?linkId=${encodeURIComponent(linkId)}`;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run → PASS.** Biome autofix. Commit: `feat(raycast): image-urls proxy helpers (privacy single-source)`.

---

### Task 3: Types for browse/trash/tags/counts

**Files:** Modify `src/lib/types.ts`; no separate test (types).

**Interfaces (add):**
```ts
export type TrashLink = CapturedLink & { deletedAt: string };
export type TagWithCount = { name: string; count: number };
export type Counts = { total?: number; trashed?: number; purgeWindowDays: number };
export type BrowseResponse = { links: CapturedLink[]; nextCursor?: string };
export type TrashResponse = { links: TrashLink[]; nextCursor?: string };
export type TagsResponse = { tags: TagWithCount[] };
export type LinkResponse = { link: CapturedLink };
```

- [ ] **Step 1:** Add the types above to `src/lib/types.ts`.
- [ ] **Step 2:** `pnpm --filter silo-raycast check-types` → PASS. Commit with Task 4 (types alone aren't independently testable; fold into the client task).

---

### Task 4: capture-client — every endpoint

**Files:** Modify `src/lib/capture-client.ts`, `src/lib/capture-client.test.ts`. (Includes Task 3's types.)

**Interfaces (add, each a thin typed `apiFetch`):**
- `browseLinks(filter: { tag?: string }): Promise<BrowseResponse>` → `GET /api/links[?tag=]`
- `listTrash(): Promise<TrashResponse>` → `GET /api/trash`
- `editNote(id, note): Promise<CapturedLink>` → `PATCH /api/links/:id { note }`
- `addTag(id, tag): Promise<CapturedLink>` → `POST /api/links/:id/tags { tag }`
- `removeTag(id, tag): Promise<CapturedLink>` → `DELETE /api/links/:id/tags/:encodeURIComponent(tag)`
- `trashLink(id): Promise<CapturedLink>` → `POST /api/links/:id/trash`
- `restoreLink(id): Promise<CapturedLink>` → `POST /api/links/:id/restore`
- `retryLink(id): Promise<CapturedLink>` → `POST /api/links/:id/retry`
- `emptyTrash(): Promise<void>` → `DELETE /api/trash` (204)
- `deleteTrashed(id): Promise<void>` → `DELETE /api/trash/:id` (204)
- `listTags(): Promise<TagWithCount[]>` → `GET /api/tags` (unwrap `.tags`)
- `getCounts(): Promise<Counts>` → `GET /api/counts`

- [ ] **Step 1: Write failing tests** in `capture-client.test.ts` (mirror the existing `fetch`-mock style; one representative per verb-shape — GET-with-query, PATCH, DELETE-path-encode, 204-no-body):

```ts
describe('editNote', () => {
  it('PATCHes note and unwraps link', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ link: { id: '1', notes: 'hi', tags: [] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { editNote } = await import('./capture-client.js');
    const link = await editNote('1', 'hi');
    expect(link.notes).toBe('hi');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/links/1'), expect.objectContaining({ method: 'PATCH' }));
  });
});

describe('emptyTrash', () => {
  it('DELETEs /api/trash and tolerates a 204 no-body', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { emptyTrash } = await import('./capture-client.js');
    await expect(emptyTrash()).resolves.toBeUndefined();
  });
});

describe('removeTag', () => {
  it('URL-encodes the tag path segment', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ link: { id:'1', tags:[] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { removeTag } = await import('./capture-client.js');
    await removeTag('1', 'a b');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/links/1/tags/a%20b'), expect.objectContaining({ method: 'DELETE' }));
  });
});
```

- [ ] **Step 2: Run → FAIL** (exports missing).

- [ ] **Step 3: Implement** all functions in `capture-client.ts`. Pattern for a link-returning call:

```ts
export async function editNote(id: string, note: string): Promise<CapturedLink> {
  const r = await apiFetch(`/api/links/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) });
  return ((await r.json()) as LinkResponse).link;
}
```

For the 204 verbs, don't call `.json()`:

```ts
export async function emptyTrash(): Promise<void> {
  await apiFetch('/api/trash', { method: 'DELETE' });
}
export async function deleteTrashed(id: string): Promise<void> {
  await apiFetch(`/api/trash/${id}`, { method: 'DELETE' });
}
```

For `browseLinks`, build the query conditionally (omit `tag` when absent, matching the API's own `exactOptionalPropertyTypes` discipline):

```ts
export async function browseLinks(filter: { tag?: string } = {}): Promise<BrowseResponse> {
  const qs = filter.tag ? `?tag=${encodeURIComponent(filter.tag)}` : '';
  const r = await apiFetch(`/api/links${qs}`, { method: 'GET' });
  return (await r.json()) as BrowseResponse;
}
```

Add the Task-3 types to `types.ts` (import `LinkResponse`, `BrowseResponse`, etc. as needed).

- [ ] **Step 4: Run → PASS.** check-types PASS. Biome autofix. Commit: `feat(raycast): capture-client — browse/trash/edit/tag/retry/restore/counts`.

---

### Task 5: Shared tag picker

**Files:** Create `src/lib/tag-picker.tsx`, `src/lib/tag-picker.test.ts`. Reuse the pure model shape from the Chrome `tag-list.ts` (filter/toggle/create), but as a Raycast `List`/`Form.TagPicker`-driven component.

**Interfaces:**
- Pure helpers (tested): `filterTags(all: TagWithCount[], query: string): TagWithCount[]`, `canCreate(all, query): string | null` (case-insensitive; null if empty or exists).
- Component `AddTagAction({ link, onDone })` and `RemoveTagAction({ link, onDone })` — render into the action panel; call `addTag`/`removeTag` then `onDone(updatedLink)`.

- [ ] **Step 1: Write failing tests** for `filterTags` + `canCreate` (pure — no Raycast render needed):

```ts
import { describe, expect, it } from 'vitest';
import { canCreate, filterTags } from './tag-picker.js';
const ALL = [{ name: 'react', count: 42 }, { name: 'reactivity', count: 4 }, { name: 'design', count: 5 }];
describe('tag-picker model', () => {
  it('filters case-insensitively', () => {
    expect(filterTags(ALL, 'REACT').map((t) => t.name)).toEqual(['react', 'reactivity']);
  });
  it('offers create only for a novel non-empty query', () => {
    expect(canCreate(ALL, 'react')).toBeNull();
    expect(canCreate(ALL, 'new')).toBe('new');
    expect(canCreate(ALL, '  ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** the pure helpers + the two action components (the components submit via `capture-client` then call `onDone`). Keep the pure model in the same file, exported, so the test hits it directly.
- [ ] **Step 4: Run → PASS.** Biome autofix. Commit: `feat(raycast): shared tag picker (filter/create) + add/remove actions`.

---

### Task 6: Shared link-detail component

**Files:** Create `src/lib/link-detail.tsx`, `src/lib/link-detail.test.tsx`.

**Interfaces:** `LinkDetail({ link }: { link: CapturedLink })` → a `List.Item.Detail` with: favicon-before-title (markdown `![](faviconUrl)` or `metadata` image), a preview image via `previewImageUrl(baseUrl, link.id)` **only when the source can have one** (youtube / twitter / a link with `imageUrl`), source-specific metadata rows (github/hn/twitter/youtube/link), and Source/Status/Saved/Tags. Uses `image-urls.ts` for every URL.

- [ ] **Step 1: Write a failing test** — since full Raycast render isn't available in vitest, test the **pure helper** that decides image + metadata, extracted as `detailModel(link, baseUrl)`:

```ts
import { describe, expect, it } from 'vitest';
import { detailModel } from './link-detail.js';
const base = 'http://localhost:8787';
it('includes a preview image for a youtube link', () => {
  const m = detailModel({ id: 'v1', url: 'https://youtube.com/watch?v=x', sourceKind: 'youtube', sourceData: { kind: 'youtube', channel: 'C', thumbnailUrl: 't' }, tags: [], title: 'V', captureStatus: 'full' } as any, base);
  expect(m.imageUrl).toBe('http://localhost:8787/api/preview-image?linkId=v1');
  expect(m.stats.find((s) => s.label === 'Channel')?.value).toBe('C');
});
it('omits the image for a plain link with no imageUrl', () => {
  const m = detailModel({ id: 'l1', url: 'https://x.dev', sourceKind: 'link', sourceData: { kind: 'link' }, tags: [], title: 'X', captureStatus: 'full', imageUrl: null } as any, base);
  expect(m.imageUrl).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** `detailModel` (pure: returns `{ faviconUrl, imageUrl|null, stats: {label,value}[], meta: {...} }`) and the thin `LinkDetail` React wrapper that renders it. All URLs from `image-urls.ts`.
- [ ] **Step 4: Run → PASS.** Biome autofix. Commit: `feat(raycast): shared link-detail (favicon, proxy image, source stats)`.

---

### Task 7: Shared action panel

**Files:** Create `src/lib/link-actions.tsx`, `src/lib/link-actions.test.tsx` (pure parts).

**Interfaces:** `LinkActions({ link, variant, onChange, onFilterTag })` where `variant: 'live' | 'trash'`. Live: Open, Copy URL, Edit note (`⌘E`), Add/Remove tag (`⌘T`/`⌘⇧T`), Retry (`⌘R`), Filter by tag (`⌘F`), Move to trash (`⌃X`, `confirmAlert`). Trash: Open, Copy, Restore (`⏎`), Delete permanently (`⌃X`, `confirmAlert`), Empty trash (`confirmAlert`). Each write calls `capture-client`, then `onChange()` (re-fetch) or updates local state.

- [ ] **Step 1: Write a failing test** for the pure action-list builder `actionsFor(variant): { id, shortcut, destructive }[]` (asserts trash actions are `destructive` and never bound to `⏎`):

```ts
import { describe, expect, it } from 'vitest';
import { actionsFor } from './link-actions.js';
it('live variant has edit/tag/retry/trash; trash uses ctrl+x not enter', () => {
  const a = actionsFor('live');
  expect(a.map((x) => x.id)).toContain('trash');
  const trash = a.find((x) => x.id === 'trash')!;
  expect(trash.destructive).toBe(true);
  expect(trash.shortcut).not.toBe('enter');
});
it('trash variant offers restore on enter and guarded delete', () => {
  const a = actionsFor('trash');
  expect(a.find((x) => x.id === 'restore')?.shortcut).toBe('enter');
  expect(a.find((x) => x.id === 'delete')?.destructive).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** `actionsFor` (pure metadata) + the `LinkActions` component that maps it to `<Action>`s with `confirmAlert` on destructive ones.
- [ ] **Step 4: Run → PASS.** Biome autofix. Commit: `feat(raycast): shared action panel (live + trash variants, guarded deletes)`.

---

### Task 8: Refactor Search to use shared detail + actions

**Files:** Modify `src/search-silo.tsx` (and its test if present).

- [ ] **Step 1:** Replace Search's inline detail/actions with `<LinkDetail>` + `<LinkActions variant="live" onFilterTag={...}>`. Keep the existing `groupByDay` sectioning, debounced `searchLinks`, and the `◌ capturing` accessory.
- [ ] **Step 2:** `pnpm --filter silo-raycast test` (existing search tests still green) + check-types. Biome autofix. Commit: `refactor(raycast): Search uses shared detail + action panel`.

---

### Task 9: Browse command (list+detail, scope dropdown, Trash)

**Files:** Create `src/browse-silo.tsx`, `src/browse-silo.test.tsx`; Modify `package.json` (add the command).

**Interfaces:** default-exported Raycast command. Scope dropdown (Library / Trash / each tag from `listTags`). Library→`browseLinks()`, tag→`browseLinks({tag})`, Trash→`listTrash()`. Reuses `<LinkDetail>` + `<LinkActions>` (variant switches to `'trash'` when scope=Trash). Trash header shows purge countdown from `getCounts().purgeWindowDays` + row `deletedAt`.

- [ ] **Step 1:** Add to `package.json` `commands`:

```json
{ "name": "browse-silo", "title": "Browse Silo", "description": "Browse your whole silo library, by tag, or the trash.", "mode": "view" }
```

- [ ] **Step 2: Write a failing test** for the pure scope→fetch selector `fetcherForScope(scope)` and the purge-countdown helper `daysUntilPurge(deletedAt, windowDays, now)`:

```ts
import { describe, expect, it } from 'vitest';
import { daysUntilPurge } from './browse-silo.js';
it('computes days left until purge', () => {
  const deleted = new Date('2026-07-01T00:00:00Z').toISOString();
  const now = new Date('2026-07-08T00:00:00Z');
  expect(daysUntilPurge(deleted, 30, now)).toBe(23);
});
```

- [ ] **Step 3: Run → FAIL. Step 4: Implement** `browse-silo.tsx`: the command component + exported pure helpers (`daysUntilPurge`, scope selection). Reuse shared components. Group Library/tag results by `groupByDay`; Trash grouped under a "In trash · purges in N days" header.
- [ ] **Step 5: Run → PASS.** check-types + `ray build`-safe (the command file is referenced by manifest). Biome autofix. Commit: `feat(raycast): Browse command — library/tag/trash with shared detail`.

---

### Task 10: Full gate + manual QA (STOP before manual QA — lead drives it)

**Files:** none.

- [ ] **Step 1: Full gate:** `pnpm turbo run check-types test --filter=silo-raycast && pnpm quality` → all PASS.
- [ ] **Step 2: Build:** `pnpm --filter silo-raycast build` → clean; manifest lists 4 commands.
- [ ] **Step 3: Manual QA** (lead + user drive in Raycast; do NOT run as the builder) — the spec's acceptance checks 1-8: Save closes + HUD; Save-with-Details; Search detail with proxied favicon+image; Browse library/tag/trash; ⌘K edit/tag/retry/trash-with-confirm; restore; **privacy** (all image requests hit `${baseUrl}`); no stuck state.

## Self-review notes (author)

- **Spec coverage:** Save-closes → T1; images/privacy → T2/T6; full client → T3/T4; tag picker → T5; detail (favicon+image+stats) → T6; action set → T7; Search → T8; Browse+Trash+scope → T9; gate/QA → T10.
- **Testability of React/Raycast:** `@raycast/api` is types-only and can't render in vitest, so each UI task extracts a **pure helper** (`detailModel`, `actionsFor`, `fetcherForScope`, `daysUntilPurge`, `filterTags`/`canCreate`) that carries the logic and IS unit-tested; the thin React wrapper is covered by the manual QA in T10. This mirrors the Chrome plan's treatment of the untestable injected function.
- **Sequential, shared tree:** tasks share `capture-client.ts`, `types.ts`, `package.json`, and the shared components are consumed by T8/T9 — execute **in order**, one at a time, no worktree fan-out.
- **The `browse-silo.tsx` file exports both a React default and pure helpers** — keep the helpers as named exports so the test imports them without rendering.
