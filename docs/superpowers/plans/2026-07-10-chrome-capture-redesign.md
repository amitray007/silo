# Chrome capture save-first redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the silo Chrome extension so clicking the toolbar icon (or `⌘⇧S`) saves the current page instantly with a designed, auto-dismissing toast; editing note+tags is one click away via a floating card with a tag dropdown; the stuck-`capturing` bug is removed.

**Architecture:** Remove the popup entirely — the MV3 `action` drops `default_popup` so `chrome.action.onClicked` fires an instant capture. Feedback is an injected shadow-DOM overlay (`lib/toast.ts`) that renders the toast and, on click, morphs in place into an edit card. The injected world can't call the API client (which owns the token), so the edit card posts its diff back to the service worker via `chrome.runtime.sendMessage`; the worker issues `PATCH /links/:id` (note) + `POST/DELETE /links/:id/tags` (tags). No `captureStatus` is read anywhere, so nothing can hang.

**Tech Stack:** TypeScript, Manifest V3, Vite, Vitest (+ `installChromeMock`), jsdom. No new dependencies.

## Global Constraints

- Extensions are plain HTTP clients — **no `@silo/core` / `@silo/api` imports** (enforced by the `extensions/**` biome `noRestrictedImports` override; `docs/rules/architecture.md`).
- Design system "Oat" (`docs/design/tokens.md`): Geist Sans 400/500 only; hierarchy by two-tone color; **sentence case**; **amber is a mark, never a fill** — the only amber is the silo mark's top grain bar, the tag active-dot, and the toast countdown bar. Primary button is ink-on-bg.
- The injected toast/edit function runs in the page's **isolated world** — it cannot reference module-closure values; everything crosses via `args`, and results return via `chrome.runtime.sendMessage`. Styles inlined (CSP; no external CSS/fonts/CDN). Light/dark follows page `prefers-color-scheme`.
- All commands run from `extensions/chrome/`. Test: `pnpm --filter @silo/extension-chrome test`. Types: `pnpm --filter @silo/extension-chrome check-types`. From repo root the quality gate is `pnpm turbo run check-types test` + `pnpm quality`.
- TDD: failing test first, minimal impl, commit per task. Stage only files this work touches — never `git add -A`.
- Branch: `feat/chrome-capture-redesign` (already checked out).

## API contract (verified — build against these, do not re-derive)

- `POST /api/links` `{ url, note?, tags? }` → `{ link, deduped }`. **Additive on re-capture** (note appends, tags only add) — used for the initial save ONLY.
- `PATCH /api/links/:id` `{ note }` → `{ link }`. **Replaces** the note (can clear/rewrite). Empty body = no-op.
- `POST /api/links/:id/tags` `{ tag }` → `{ link }`. Adds one tag. `404` if id unknown/trashed.
- `DELETE /api/links/:id/tags/:tag` → `{ link }`. Removes one tag; removing an absent tag is a no-op `200`.
- `GET /api/tags` → `{ tags: { name, count }[] }`. Feeds the dropdown.
- Every write returns the `{ link }` envelope.

## File structure

**Modify**
- `public/manifest.json` — drop `default_popup`; keep `action` for the icon; keep `scripting`, `activeTab`, `contextMenus`, `storage` permissions.
- `src/background/service-worker.ts` — add `chrome.action.onClicked` → `captureActiveTab`; add a `chrome.runtime.onMessage` handler for edit-diff application.
- `src/background/capture-flow.ts` — `runQuietCapture` passes `link.id` into `showToast`.
- `src/lib/capture-client.ts` — add `editNote`, `addTag`, `removeTag`; **remove** `getLink`.
- `src/lib/toast.ts` — extend the injected surface: toast + morph-to-edit-card + tag dropdown + hover-pause dismiss + message-passing.
- `src/lib/tag-list.ts` — repurpose to the dropdown model (filter + toggle + create + diff).
- `src/lib/types.ts` — drop the `getLink`-only `GetLinkResponse` / `captureStatus` field if now unused; add an `EditDiff` type.

**Create**
- `src/lib/edit-diff.ts` (+ `.test.ts`) — pure diff computation (original vs edited → note change + added/removed tags).

**Delete**
- `src/popup/popup.ts`, `src/popup/popup.css`, `popup.html` (+ any popup entry in `vite.config.ts`).
- `src/lib/recent.ts` (+ `.test.ts`).
- `src/lib/capture-client.test.ts`'s `getLink` cases; `popup`-specific tests.

---

### Task 1: Manifest — icon fires a click, not a popup

**Files:**
- Modify: `public/manifest.json`
- Modify: `src/background/service-worker.ts:4-38`
- Test: `src/background/service-worker.test.ts` (create)

**Interfaces:**
- Consumes: `captureActiveTab()` from `capture-flow.ts` (existing, unchanged signature `(): Promise<void>`).
- Produces: a service worker that registers `chrome.action.onClicked` calling `captureActiveTab`.

- [ ] **Step 1: Write the failing test** — `src/background/service-worker.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../test-support/chrome-mock.js';

describe('service worker registration', () => {
  beforeEach(() => {
    vi.resetModules();
    const chrome = installChromeMock();
    // add the action namespace the mock doesn't yet have
    (chrome as unknown as { action: { onClicked: { addListener: ReturnType<typeof vi.fn> } } }).action = {
      onClicked: { addListener: vi.fn() },
    };
  });

  it('registers an action.onClicked listener', async () => {
    await import('./service-worker.js');
    const listener = (globalThis.chrome as unknown as {
      action: { onClicked: { addListener: ReturnType<typeof vi.fn> } };
    }).action.onClicked.addListener;
    expect(listener).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Add `action` to the chrome mock** — `src/test-support/chrome-mock.ts`, inside the `mock` object (after `commands`):

```ts
    action: {
      onClicked: { addListener: vi.fn() },
    },
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @silo/extension-chrome test -- service-worker`
Expected: FAIL — `action.onClicked.addListener` called 0 times.

- [ ] **Step 4: Wire the click handler** — in `src/background/service-worker.ts`, after the `chrome.commands.onCommand` block, add:

```ts
// The toolbar icon now has NO default_popup (manifest.json), so clicking it
// fires action.onClicked here — the instant-save path. Same shared
// runQuietCapture funnel as the keyboard command; failures are reported by
// the toast inside it, so the .catch is a documented no-op.
chrome.action.onClicked.addListener(() => {
  captureActiveTab().catch(() => {
    // Already reported via the toast inside runQuietCapture.
  });
});
```

Update the file's top doc comment: replace the paragraph claiming `default_popup` blocks `onClicked` with: `The toolbar action has NO default_popup, so clicking the icon fires action.onClicked (instant save). All THREE triggers (icon, keyboard command, context menu) funnel through runQuietCapture.`

- [ ] **Step 5: Edit the manifest** — `public/manifest.json`: delete the `"default_popup": "popup.html",` line inside `"action"` (keep `default_icon`). Delete the `"options_page"` line only if the options page is also being removed — **keep it** (Base URL / token config still needed).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @silo/extension-chrome test -- service-worker`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/manifest.json src/background/service-worker.ts src/background/service-worker.test.ts src/test-support/chrome-mock.ts
git commit -m "feat(chrome): icon click fires instant capture (drop default_popup)"
```

---

### Task 2: Edit-diff — pure note+tags diff computation

**Files:**
- Create: `src/lib/edit-diff.ts`, `src/lib/edit-diff.test.ts`
- Modify: `src/lib/types.ts` (add `EditDiff`, `EditState`)

**Interfaces:**
- Produces:
  - `type EditState = { note: string; tags: string[] }`
  - `type EditDiff = { note?: string; addedTags: string[]; removedTags: string[] }`
  - `computeEditDiff(original: EditState, edited: EditState): EditDiff | null` — returns `null` if nothing changed. `note` is present in the diff only if it differs from `original.note` (trimmed compare). Tag compare is case-insensitive on trimmed value; order-insensitive.

- [ ] **Step 1: Write the failing test** — `src/lib/edit-diff.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { computeEditDiff } from './edit-diff.js';

describe('computeEditDiff', () => {
  it('returns null when nothing changed', () => {
    expect(computeEditDiff({ note: 'a', tags: ['x'] }, { note: 'a', tags: ['x'] })).toBeNull();
  });

  it('detects a changed note', () => {
    expect(computeEditDiff({ note: '', tags: [] }, { note: 'hi', tags: [] })).toEqual({
      note: 'hi',
      addedTags: [],
      removedTags: [],
    });
  });

  it('treats a whitespace-only note change as no change', () => {
    expect(computeEditDiff({ note: 'a', tags: [] }, { note: '  a  ', tags: [] })).toBeNull();
  });

  it('detects added and removed tags, case-insensitively', () => {
    const diff = computeEditDiff({ note: '', tags: ['react'] }, { note: '', tags: ['REACT', 'new'] });
    expect(diff).toEqual({ addedTags: ['new'], removedTags: [] });
  });

  it('detects a removed tag', () => {
    expect(computeEditDiff({ note: '', tags: ['a', 'b'] }, { note: '', tags: ['a'] })).toEqual({
      addedTags: [],
      removedTags: ['b'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silo/extension-chrome test -- edit-diff`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/edit-diff.ts`

```ts
import type { EditDiff, EditState } from './types.js';

const key = (t: string): string => t.trim().toLowerCase();

/**
 * Diffs the edit card's current state against what was saved. Returns null
 * when nothing changed (the card can skip all network calls). Note compares
 * trimmed; tags compare case-insensitively and order-insensitively, mirroring
 * the API's own tag dedup key (trim + lowercase).
 */
export function computeEditDiff(original: EditState, edited: EditState): EditDiff | null {
  const noteChanged = original.note.trim() !== edited.note.trim();
  const origKeys = new Set(original.tags.map(key));
  const editKeys = new Set(edited.tags.map(key));
  const addedTags = edited.tags.filter((t) => !origKeys.has(key(t)));
  const removedTags = original.tags.filter((t) => !editKeys.has(key(t)));

  if (!noteChanged && addedTags.length === 0 && removedTags.length === 0) return null;

  const diff: EditDiff = { addedTags, removedTags };
  if (noteChanged) diff.note = edited.note.trim();
  return diff;
}
```

Add to `src/lib/types.ts`:

```ts
/** The edit card's editable state (mirrors what the UI holds). */
export type EditState = { note: string; tags: string[] };

/** The minimal set of changes to apply — note (replace) + tag add/remove. */
export type EditDiff = { note?: string; addedTags: string[]; removedTags: string[] };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @silo/extension-chrome test -- edit-diff`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/edit-diff.ts src/lib/edit-diff.test.ts src/lib/types.ts
git commit -m "feat(chrome): pure edit-diff for note + tag changes"
```

---

### Task 3: Capture client — edit endpoints in, getLink out

**Files:**
- Modify: `src/lib/capture-client.ts:87-91` (remove `getLink`), add three functions.
- Modify: `src/lib/capture-client.test.ts` (drop `getLink` cases, add new).
- Modify: `src/lib/types.ts` (remove `GetLinkResponse` and, if now unused anywhere, the `captureStatus` field on `CapturedLink`).

**Interfaces:**
- Consumes: `apiFetch` (private, existing), `CaptureError` (existing).
- Produces:
  - `editNote(id: string, note: string): Promise<CapturedLink>` → `PATCH /api/links/:id` body `{ note }`.
  - `addTag(id: string, tag: string): Promise<CapturedLink>` → `POST /api/links/:id/tags` body `{ tag }`.
  - `removeTag(id: string, tag: string): Promise<CapturedLink>` → `DELETE /api/links/:id/tags/:encodeURIComponent(tag)`.
  - Each unwraps `{ link }` and returns `link`.

- [ ] **Step 1: Write the failing test** — add to `src/lib/capture-client.test.ts` (follow the file's existing `fetch`-mock style):

```ts
describe('editNote', () => {
  it('PATCHes the note and returns the link', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ link: { id: '1', url: 'u', title: null, notes: 'hi', tags: [] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { editNote } = await import('./capture-client.js');
    const link = await editNote('1', 'hi');
    expect(link.notes).toBe('hi');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/links/1'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('removeTag', () => {
  it('URL-encodes the tag in the path', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ link: { id: '1', url: 'u', title: null, notes: null, tags: [] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { removeTag } = await import('./capture-client.js');
    await removeTag('1', 'a b');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/links/1/tags/a%20b'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
```

Delete the existing `getLink` `describe` block(s) in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silo/extension-chrome test -- capture-client`
Expected: FAIL — `editNote`/`removeTag` not exported.

- [ ] **Step 3: Implement** — in `src/lib/capture-client.ts`, replace the `getLink` function (lines ~87-91) with:

```ts
/** `PATCH /api/links/:id` — replace the note (edit card). */
export async function editNote(id: string, note: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  return ((await response.json()) as { link: CapturedLink }).link;
}

/** `POST /api/links/:id/tags` — add one tag (edit card). */
export async function addTag(id: string, tag: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag }),
  });
  return ((await response.json()) as { link: CapturedLink }).link;
}

/** `DELETE /api/links/:id/tags/:tag` — remove one tag (edit card). */
export async function removeTag(id: string, tag: string): Promise<CapturedLink> {
  const response = await apiFetch(`/api/links/${id}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
  return ((await response.json()) as { link: CapturedLink }).link;
}
```

Remove the now-unused `GetLinkResponse` import if present. In `src/lib/types.ts`, delete `GetLinkResponse`. Leave `captureStatus` on `CapturedLink` only if some remaining code reads it; grep first (`grep -rn captureStatus src`) — if zero hits after this task, delete the field.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @silo/extension-chrome test -- capture-client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture-client.ts src/lib/capture-client.test.ts src/lib/types.ts
git commit -m "feat(chrome): capture-client editNote/addTag/removeTag; remove getLink"
```

---

### Task 4: Service worker — apply an edit diff via message-passing

**Files:**
- Modify: `src/background/service-worker.ts` (add `onMessage` handler)
- Create: `src/background/apply-edit.ts`, `src/background/apply-edit.test.ts`

**Interfaces:**
- Consumes: `editNote`, `addTag`, `removeTag` (Task 3); `EditDiff` (Task 2).
- Produces: `applyEdit(id: string, diff: EditDiff): Promise<{ ok: true } | { ok: false; message: string }>` — issues PATCH (if `diff.note !== undefined`), then each added tag, then each removed tag, sequentially. First failure returns `{ ok: false, message }` (from `CaptureError.message` or a generic string); success returns `{ ok: true }`.

- [ ] **Step 1: Write the failing test** — `src/background/apply-edit.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/capture-client.js', () => ({
  editNote: vi.fn(async () => ({})),
  addTag: vi.fn(async () => ({})),
  removeTag: vi.fn(async () => ({})),
  CaptureError: class extends Error {},
}));

describe('applyEdit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues PATCH + add + remove in order and returns ok', async () => {
    const client = await import('../lib/capture-client.js');
    const { applyEdit } = await import('./apply-edit.js');
    const res = await applyEdit('1', { note: 'hi', addedTags: ['new'], removedTags: ['old'] });
    expect(res).toEqual({ ok: true });
    expect(client.editNote).toHaveBeenCalledWith('1', 'hi');
    expect(client.addTag).toHaveBeenCalledWith('1', 'new');
    expect(client.removeTag).toHaveBeenCalledWith('1', 'old');
  });

  it('skips the PATCH when note is undefined', async () => {
    const client = await import('../lib/capture-client.js');
    const { applyEdit } = await import('./apply-edit.js');
    await applyEdit('1', { addedTags: [], removedTags: [] });
    expect(client.editNote).not.toHaveBeenCalled();
  });

  it('returns ok:false with the message on first failure', async () => {
    const client = await import('../lib/capture-client.js');
    (client.addTag as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new (client.CaptureError as new (k: string, m: string) => Error)('server', 'boom'),
    );
    const { applyEdit } = await import('./apply-edit.js');
    const res = await applyEdit('1', { addedTags: ['x'], removedTags: [] });
    expect(res).toEqual({ ok: false, message: 'boom' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silo/extension-chrome test -- apply-edit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/background/apply-edit.ts`

```ts
import { CaptureError, addTag, editNote, removeTag } from '../lib/capture-client.js';
import type { EditDiff } from '../lib/types.js';

/**
 * Applies an edit-card diff to an already-saved link, sequentially: note
 * PATCH (replace), then each added tag, then each removed tag. First failure
 * aborts and surfaces its message — the Flow-1 save is untouched regardless.
 */
export async function applyEdit(
  id: string,
  diff: EditDiff,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (diff.note !== undefined) await editNote(id, diff.note);
    for (const tag of diff.addedTags) await addTag(id, tag);
    for (const tag of diff.removedTags) await removeTag(id, tag);
    return { ok: true };
  } catch (error) {
    const message = error instanceof CaptureError ? error.message : 'Could not save details';
    return { ok: false, message };
  }
}
```

In `src/background/service-worker.ts`, add the message handler (define the message shape inline; the injected card sends `{ type: 'silo-apply-edit', id, diff }`):

```ts
import { applyEdit } from './apply-edit.js';
import type { EditDiff } from '../lib/types.js';

type ApplyEditMessage = { type: 'silo-apply-edit'; id: string; diff: EditDiff };

chrome.runtime.onMessage.addListener(
  (message: ApplyEditMessage, _sender, sendResponse): boolean => {
    if (message?.type !== 'silo-apply-edit') return false;
    applyEdit(message.id, message.diff).then(sendResponse);
    return true; // keep the message channel open for the async sendResponse
  },
);
```

Add `runtime.onMessage: { addListener: vi.fn() }` to the chrome mock's `runtime` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @silo/extension-chrome test -- apply-edit`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/background/apply-edit.ts src/background/apply-edit.test.ts src/background/service-worker.ts src/test-support/chrome-mock.ts
git commit -m "feat(chrome): service worker applies edit diffs (PATCH + tag add/remove)"
```

---

### Task 5: Tag dropdown model — filter, toggle, create

**Files:**
- Modify: `src/lib/tag-list.ts` (repurpose), `src/lib/tag-list.test.ts`

**Interfaces:**
- Produces (pure, DOM-free — the injected UI in Task 6 consumes these):
  - `type TagPickerState = { all: { name: string; count: number }[]; selected: Set<string>; query: string }`
  - `createTagPicker(all): TagPickerState`
  - `filterTags(state): { name: string; count: number }[]` — case-insensitive substring match on `query`, excludes nothing (selected still shown, marked via `selected`).
  - `toggleTag(state, name): void`
  - `canCreate(state): string | null` — the trimmed `query` if it's non-empty and matches no existing tag name (case-insensitive), else `null`.
  - `selectedList(state): string[]`

- [ ] **Step 1: Write the failing test** — replace `src/lib/tag-list.test.ts` contents:

```ts
import { describe, expect, it } from 'vitest';
import { canCreate, createTagPicker, filterTags, selectedList, toggleTag } from './tag-list.js';

const ALL = [
  { name: 'react', count: 42 },
  { name: 'react-native', count: 9 },
  { name: 'design', count: 5 },
];

describe('tag picker', () => {
  it('filters by case-insensitive substring', () => {
    const s = createTagPicker(ALL);
    s.query = 'REACT';
    expect(filterTags(s).map((t) => t.name)).toEqual(['react', 'react-native']);
  });

  it('toggles selection', () => {
    const s = createTagPicker(ALL);
    toggleTag(s, 'react');
    expect(selectedList(s)).toEqual(['react']);
    toggleTag(s, 'react');
    expect(selectedList(s)).toEqual([]);
  });

  it('offers create only for a non-matching non-empty query', () => {
    const s = createTagPicker(ALL);
    s.query = 'react';
    expect(canCreate(s)).toBeNull();
    s.query = 'brand-new';
    expect(canCreate(s)).toBe('brand-new');
    s.query = '   ';
    expect(canCreate(s)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silo/extension-chrome test -- tag-list`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement** — replace `src/lib/tag-list.ts` contents:

```ts
/**
 * The edit card's tag-dropdown model — pure state + queries, DOM-free so it's
 * testable without jsdom. The injected UI (lib/toast.ts) renders from these.
 * Replaces the old inline-pill model; filtering + create-new + toggle live
 * here.
 */
export type TagOption = { name: string; count: number };
export type TagPickerState = { all: TagOption[]; selected: Set<string>; query: string };

const key = (t: string): string => t.trim().toLowerCase();

export function createTagPicker(all: TagOption[], selected: string[] = []): TagPickerState {
  return { all, selected: new Set(selected), query: '' };
}

/** Existing tags matching the current query (case-insensitive substring). */
export function filterTags(state: TagPickerState): TagOption[] {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.all;
  return state.all.filter((t) => t.name.toLowerCase().includes(q));
}

export function toggleTag(state: TagPickerState, name: string): void {
  if (state.selected.has(name)) state.selected.delete(name);
  else state.selected.add(name);
}

/** The query as a new-tag candidate, or null if empty / already an existing tag. */
export function canCreate(state: TagPickerState): string | null {
  const trimmed = state.query.trim();
  if (!trimmed) return null;
  const exists = state.all.some((t) => key(t.name) === key(trimmed));
  return exists ? null : trimmed;
}

export function selectedList(state: TagPickerState): string[] {
  return [...state.selected];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @silo/extension-chrome test -- tag-list`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tag-list.ts src/lib/tag-list.test.ts
git commit -m "feat(chrome): tag-picker model — filter, toggle, create-new"
```

---

### Task 6: Injected surface — toast, hover-pause, morph-to-edit-card

**Files:**
- Modify: `src/lib/toast.ts` (extend), `src/lib/toast.test.ts` (create if absent)
- Modify: `src/background/capture-flow.ts:14-32` (pass `link.id` into `showToast`)

**Interfaces:**
- Consumes: `showToast(tabId, payload)` extended payload `{ kind, title, url, linkId, tags: {name,count}[] }`.
- Produces: an injected shadow-DOM host that (a) shows the toast, (b) auto-dismisses after 3000ms with a countdown bar, (c) pauses the countdown on pointerenter and resumes on pointerleave, (d) on toast/✎ click swaps to the edit card, (e) on Save details sends `{ type: 'silo-apply-edit', id, diff }` and closes on `{ ok: true }`.

**Note on testing the injected function:** the injected `renderToast`/`renderEdit` body runs in-page and is hard to unit-test through `executeScript`. Test only the **module-level** `showToast` wiring (that it calls `chrome.scripting.executeScript` with the right `args`) here; the in-page DOM behavior (hover-pause, morph) is covered by the manual QA checklist in Task 8. Keep the injected function self-contained and small.

- [ ] **Step 1: Write the failing test** — `src/lib/toast.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from '../test-support/chrome-mock.js';
import { showToast } from './toast.js';

describe('showToast', () => {
  let chrome: ReturnType<typeof installChromeMock>;
  beforeEach(() => {
    chrome = installChromeMock();
  });

  it('injects with the payload passed through args', async () => {
    await showToast(7, { kind: 'saved', title: 'T', url: 'https://x', linkId: 'id1', tags: [] });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 7 },
        args: [expect.objectContaining({ kind: 'saved', linkId: 'id1' })],
      }),
    );
  });

  it('swallows an injection failure', async () => {
    (chrome.scripting.executeScript as unknown as { mockRejectedValueOnce: (e: Error) => void })
      .mockRejectedValueOnce(new Error('cannot inject'));
    await expect(
      showToast(7, { kind: 'saved', title: 'T', url: 'https://x', linkId: 'id1', tags: [] }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silo/extension-chrome test -- toast`
Expected: FAIL — `ToastPayload` lacks `url`/`linkId`/`tags`; type error or arg mismatch.

- [ ] **Step 3: Extend `src/lib/toast.ts`.** Widen `ToastPayload`:

```ts
export type ToastKind = 'saved' | 'deduped' | 'error';
export type ToastPayload = {
  kind: ToastKind;
  title: string;
  url: string;
  linkId: string;
  tags: { name: string; count: number }[];
};
```

Keep `showToast` as-is (it already forwards `payload` through `args`). Extend the injected `renderToast` function to implement the Oat-styled card per `docs/design/tokens.md` and the mockup (`claude.ai/code/artifact/07528102-0f15-4402-a1d5-93aad2ad14c5`), self-contained in the page world:
- silo stack-mark SVG (three bars, top bar grain gradient) anchoring the head;
- heading per kind (saved/deduped/error), title subtitle, ✎ + ✕ buttons;
- a countdown bar animating width 100%→0 over 3000ms; `pointerenter` sets `animation-play-state: paused` (and clears the removal timeout), `pointerleave` resumes (and re-arms the timeout for the remaining time);
- clicking the body or ✎ replaces the card's inner DOM with the edit form (note textarea + tag dropdown built from `payload.tags`, using the same visual spec) — do NOT re-inject; swap innerHTML within the existing shadow host and cancel the dismiss timer while editing;
- Save details: compute `{ note, tags }`, `chrome.runtime.sendMessage({ type: 'silo-apply-edit', id: payload.linkId, diff })` where `diff` is computed inline in-page (the injected world can't import `edit-diff.ts`; replicate the trivial diff there against `payload` originals — note starts empty, tags start empty for a fresh capture, so `addedTags` = selected, `removedTags` = []). On `{ ok:true }` remove the host; on `{ ok:false }` show `res.message` inline and keep the card open;
- reduced-motion: skip transforms, keep opacity fades (mirror the existing toast).

Change the auto-dismiss constant from `2000` to `3000`.

- [ ] **Step 4: Pass `link.id` from capture-flow** — `src/background/capture-flow.ts`, in `runQuietCapture`, change the `showToast` call to include the new fields, and fetch tag suggestions for the edit dropdown:

```ts
import { captureLink, listTags } from '../lib/capture-client.js';
// ...
const { link, deduped } = await captureLink(request);
await trackCapturedId?.(link.id); // remove if recent.ts deleted — see Task 7
if (tabId !== undefined) {
  const tags = await listTags().catch(() => []);
  await showToast(tabId, {
    kind: deduped ? 'deduped' : 'saved',
    title: displayTitle,
    url: request.url,
    linkId: link.id,
    tags,
  });
}
```

(If Task 7 has already removed `recent.ts`, drop the `trackCapturedId` line entirely.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @silo/extension-chrome test -- toast`
Expected: PASS. Then `pnpm --filter @silo/extension-chrome check-types` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/toast.ts src/lib/toast.test.ts src/background/capture-flow.ts
git commit -m "feat(chrome): injected toast with hover-pause + morph-to-edit card"
```

---

### Task 7: Remove the popup and recent-list (dead code)

**Files:**
- Delete: `src/popup/popup.ts`, `src/popup/popup.css`, `popup.html`, `src/lib/recent.ts`, `src/lib/recent.test.ts`
- Modify: `vite.config.ts` (drop the popup entry/input), `src/background/capture-flow.ts` (drop `trackCapturedId` if still referenced)

**Interfaces:** none produced — pure removal. After this task, `grep -rn "recent\|popup\|trackCapturedId\|getRecentIds" src` returns zero hits (except unrelated words).

- [ ] **Step 1: Delete the files**

```bash
git rm src/popup/popup.ts src/popup/popup.css popup.html src/lib/recent.ts src/lib/recent.test.ts
```

- [ ] **Step 2: Remove popup from the Vite build** — open `vite.config.ts`; in the `build.rollupOptions.input` (or the manifest-plugin config) delete the `popup` entry. If the config derives inputs from `manifest.json`, no change is needed — verify by reading it.

- [ ] **Step 3: Drop lingering references** — in `src/background/capture-flow.ts` remove the `trackCapturedId` import and call if still present (Task 6 may have left a guarded call). `grep -rn "trackCapturedId\|getRecentIds\|recent" src` — expect zero.

- [ ] **Step 4: Full build + test + types**

Run: `pnpm --filter @silo/extension-chrome build && pnpm --filter @silo/extension-chrome test && pnpm --filter @silo/extension-chrome check-types`
Expected: build emits `dist/` with no `popup.*`; all tests PASS; types PASS.

- [ ] **Step 5: Run knip to confirm no dead exports remain**

Run (repo root): `pnpm quality`
Expected: PASS — no knip "unused file/export" for the removed modules.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "chore(chrome): remove popup + recent-list (superseded by toast/edit flow)"
```

---

### Task 8: Full quality gate + manual QA against real silo

**Files:** none (verification task).

- [ ] **Step 1: Quality gate (repo root)**

Run: `pnpm turbo run check-types test --filter=@silo/extension-chrome && pnpm quality`
Expected: all PASS.

- [ ] **Step 2: Build + load unpacked**

```bash
pnpm --filter @silo/extension-chrome build
```
Load `extensions/chrome/dist/` at `chrome://extensions` (Developer mode → Load unpacked). Add the extension's `chrome-extension://<id>` origin to the server's `SILO_ALLOWED_ORIGINS` and restart the API (`README.md` "Cross-origin setup").

- [ ] **Step 3: Manual QA checklist** (drive it, observe behavior — `docs/design/tokens.md` + spec acceptance checks):
  1. Click icon on an http(s) page → saves, no popup, saved toast with silo mark + title.
  2. `⌘⇧S` → same, no mouse.
  3. `chrome://extensions` tab → click icon → no-op, no toast, no error.
  4. Toast auto-dismisses ~3s; **hover pauses** the countdown; leaving resumes.
  5. Click toast → edit card in place; add note + 2 tags (one via dropdown filter, one via Create); **Save details** → card closes; verify in the web app the link has that note + tags.
  6. Re-open (save same URL again, click toast) → remove a tag via its ✕ + rewrite the note → Save details → verify the tag is gone and the note **replaced** (not appended) in the web app.
  7. Stop silo → click icon → actionable "could not reach silo" error toast; **nothing hangs** in a capturing state.
  8. Toggle OS dark mode → repeat 1 + 5 → Oat dark tokens render; amber only on mark/active-dot/countdown.

- [ ] **Step 4: Record QA results** in the PR description (pass/fail per item + any fixes). If any item fails, fix on this branch with a regression test where feasible, re-run Step 1, then re-QA.

---

## Self-review notes (author)

- **Spec coverage:** Flow 1 → T1/T6; Flow 2 → T2/T3/T4/T6; Flow 3 (dropdown) → T5/T6; stuck-`capturing` removal → T3 (getLink out) + T7 (recent-list out); design fidelity → T6 + T8; deletions → T7; acceptance checks → T8.
- **The one runtime risk:** the injected edit card must inline its own trivial diff (can't import `edit-diff.ts` into the page world). For a **fresh** capture the originals are empty (note `''`, tags `[]`), so the in-page diff is just "selected tags = added, note = note"; `edit-diff.ts` (T2) governs the service-worker-side path and any future non-empty-original case. Called out in T6 Step 3.
- **Not parallelizable across a shared tree:** tasks share `types.ts`, `capture-flow.ts`, `service-worker.ts`, `chrome-mock.ts`. Execute **sequentially** (subagent-driven, one task at a time), not fanned out into worktrees.
