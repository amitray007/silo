# De-duplicate repeated API calls (perf)

**Status:** proposed (gate-1 pending user approval)
**Date:** 2026-07-11
**Source:** ce-performance-oracle audit (this session) — findings 1-4.

## Motivation

The user observes API endpoints firing more than once / when they shouldn't.
The audit found the causes. Fix all four (the two real per-page wastes + the
two invalidation/key cleanups). Note: some dev-only doubles are React
StrictMode and are NOT bugs — this slice targets the prod-real ones.

## Units (independent; each leaves the tree working, each tested)

### Unit 1 — Gate the CommandPalette's fetches on `open` (highest impact)

**Problem:** `<CommandPalette>` is mounted permanently (`AppFrame.tsx:352`),
and `usePaletteResults(...)` runs at `CommandPalette.tsx:493` — BEFORE the
`if (!open) return null` at line 518. React runs all hooks before the early
return, so the palette's `useInfiniteLinks` / `useTrashList` / `useTags`
observers are active on EVERY page even while the palette is closed:
- on `/trash`: a phantom `GET /api/links` (and a 1.5s enriching poll) the page
  never uses;
- on `/` and `/tags/*`: a phantom `GET /api/trash`.

**Fix:** Split the component. `CommandPalette` becomes a thin wrapper that owns
only `open` + the capture-phase Escape effect, and renders
`<CommandPaletteInner palette={palette} />` **only when `open`**. Move
`usePaletteResults` + `usePaletteScope` + all the result-render/handlers into
`CommandPaletteInner`. Because the inner component only mounts when open, none
of its data hooks run while closed — no hook-signature changes needed.
- Keep the Escape effect where it is (it's already `if (!open) return`-guarded
  and must be armed on the wrapper so Escape works the instant it opens — or
  move it inside the inner, which only exists when open; either is fine, pick
  the one that keeps behavior identical — verify Escape still closes).
- Preserve the scrim/blur/panel markup exactly (move it into the inner).

**Acceptance:** existing CommandPalette tests pass (they render it open); add a
test that when `open` is false, the palette's data hooks do NOT fetch (mock
fetch, render closed, assert no `/api/links` / `/api/trash` call). Browser-QA:
DevTools network on `/trash` shows NO `/api/links`; on `/` shows NO
`/api/trash`; opening ⌘K then fetches; the enriching poll on `/trash` is gone.

### Unit 2 — Narrow `invalidateLinkQueries` per mutation

**Problem (`hooks.ts:359-364`):** one blanket `invalidateLinkQueries`
invalidates `['links']` + `['link']` + `counts` + `tags` and is used by
`useEditLink`, `useTrashLink`, `useAddTag`, `useRemoveTag`, `useRetryCapture`,
`useBulkTrash`. So editing a link's TITLE refetches `/api/tags` + `/api/counts`
(via the Sidebar) though neither changed.

**Fix:** split by what each mutation actually affects:
- `useEditLink`, `useRetryCapture` → `['links']` + `['link']` only.
- `useAddTag`, `useRemoveTag` → `['links']` + `['link']` + `tags` (tag counts
  change), NOT `counts`.
- `useTrashLink`, `useBulkTrash` → `['links']` + `['link']` + `counts` + `tags`
  (a link moving to trash changes live count AND per-tag counts).
Keep small named helpers per affect-set rather than one blanket helper. Add a
one-line comment on each stating WHY that set (so it doesn't drift back to
blanket).

**Acceptance:** update/extend the hooks tests that assert invalidation sets
(they exist — the audit references invalidatedKeys assertions). Assert
`useEditLink` does NOT invalidate `tags`/`counts`; `useAddTag` invalidates
`tags` not `counts`; `useTrashLink` invalidates both.

### Unit 3 — Drop the redundant double-invalidate in `useCaptureLink`

**Problem (`hooks.ts:340-345`):** `onSettled` invalidates
`queryKeys.links()` (= `['links', {}]`) AND `['links']` — the second is a
prefix superset of the first, so the first line is fully redundant.

**Fix:** delete the `invalidateQueries({ queryKey: queryKeys.links() })` line;
keep the `['links']` prefix invalidate + counts + tags (capture DOES change
counts and can create a tag, so those stay).

**Acceptance:** the capture test still asserts links/counts/tags get
invalidated; just no longer double-invalidates links.

### Unit 4 — Canonicalize `queryKeys.links` (latent key-hardening)

**Problem (`hooks.ts:43`):** `links: (filter?) => ['links', filter ?? {}]`.
The `filter` type is `{ tag?; status? }`. Today no caller passes `status`, but
a future `{ tag:'x', status: undefined }` would hash DIFFERENTLY from
`{ tag:'x' }` under TanStack's structural hasher (an explicit `undefined` key
is not stripped) → a silent cache miss / duplicate fetch of the same data.

**Fix:** build the key object explicitly, omitting undefined fields — e.g.
`links: (filter) => ['links', filter?.tag ? { tag: filter.tag } : {}]` (extend
if `status` ever becomes real, always omit-when-undefined). Add a comment: any
new filter field must be OMITTED when undefined, never set to `undefined`, or
it defeats the cache key.

**Acceptance:** a small unit test on `queryKeys.links` that
`links({ tag: 'x' })`, `links({ tag: 'x', status: undefined })`, and a
hypothetical undefined-stripping all produce the SAME key array (deep-equal).

## Non-goals (parked)

- StrictMode dev-doubles — NOT bugs (won't happen in prod build); do not chase.
- The intentional enriching `refetchInterval` poll — leave (Unit 1 removes only
  its cross-route fan-out, not the poll on the real feed).
- `useLinksByTag`'s deliberately-separate key family — leave (documented
  correctness-over-dedup tradeoff).
- The prefetch-sentinel re-arm + `useUpdateSettings` settle-invalidate —
  audited as acceptable; no change.

## Review + QA plan (binding protocol)

- After each unit: check-types + test + quality green.
- Independent review: correctness (the invalidation-narrowing must not drop a
  refetch that's genuinely needed — e.g. don't stop refreshing tag counts on a
  tag mutation) + the ce-performance lens re-confirming the dupes are gone.
- Intense QA in-browser with DevTools network: on `/trash` no phantom
  `/api/links`; on `/` no phantom `/api/trash`; open ⌘K → fetches happen; edit
  a title → only `/api/links` + `/api/links/:id`, NOT `/api/tags`/`/api/counts`;
  add a tag → `/api/tags` refetches but NOT `/api/counts`; trash a link →
  both. Note StrictMode dev-doubles explicitly so a doubled single-shot GET
  isn't mistaken for a regression.

## Commit / branch

Per the standing session override: commit straight to `main`, staging by
explicit path, full local gate before each push.
