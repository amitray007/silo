# Method: tag-scoped capture, Empty Now on Trash, context-aware Cmd+V

Web-only. All backend plumbing already exists (research-confirmed). No API/core/db changes.

## Goals (user-approved)
1. **Tag page:** the "Add" button (and paste) captures the link AND applies the
   current tag, so it shows in that tag view immediately.
2. **Trash page:** NOT an Add button — an **"Empty Now"** button (same pill
   design as Add, trash-bin icon) that empties trash, behind an **inline
   two-step confirm** (destructive/irreversible). Pasting a URL on the trash
   page still captures to the Library normally (unchanged).
3. **Cmd+V / paste-anywhere:** context-aware — on a tag page it applies that
   tag; on Library/Trash it's a normal Library capture.

## What already exists (do NOT rebuild — research-confirmed)
- Tag-scoped capture is fully plumbed: `CaptureRequest.tags?` (types.ts:168),
  `captureBodySchema.tags` (query-schemas.ts:49), `createLink` `attachTags`
  (links.ts:436). `captureLink.mutate({ url, tags: [tag] })` just works.
- Empty trash: `useEmptyTrash()` (hooks.ts:650) → `DELETE /api/trash` →
  `{ deleted }`; `core.emptyTrash()` exists. Already used by TrashView's idle
  dock "Empty all". The header button re-surfaces this SAME hook.
- Inline two-step confirm pattern: `SettingsTabs/AccessTab.tsx:40-70`
  (`useState(confirming)`, disable while pending). Mirror it.
- Routing: react-router-dom. TagView reads tag via `useParams<{name}>()`
  (TagView.tsx:41). AppFrame is ABOVE the `:name` segment, so useParams is
  undefined there — use `useMatch('/tags/:name')` (or parse `useLocation`) in
  AppFrame to get the current tag for the paste handler.

## Frozen decisions
1. **Extract a presentational `HeaderActionButton`** from the current inline
   `PasteCaptureButton` (LibraryView.tsx:52). It renders the pill button (icon +
   label, `.silo-icon-btn-sm`, the `1px solid var(--line)`/`var(--bg2)`/
   `var(--ink)` pill style already there) + the absolutely-positioned inline
   flash span + `disabled` handling. Props: `icon`, `label`, `onClick` (async),
   `disabled?`, and the flash state (or it owns its own `usePasteFlash`). Keep it
   dumb; callers supply behavior. Put it in its own file
   (`components/HeaderActionButton.tsx`) so Library/Tag/Trash all import it.
2. **`PasteCaptureButton` gains a `tags?: string[]` prop.** The ONLY behavioral
   change: `captureLink.mutate({ url: trimmed, tags })`. Library passes nothing;
   TagView passes `[tag]`. Everything else (clipboard read, `looksLikeUrl`,
   flash messages, `isPending`) is identical. Keep it using the extracted
   `HeaderActionButton` for chrome.
3. **TagView:** pass `headerSlot={<PasteCaptureButton tags={[tag]} />}` to its
   `ContentFrame` (currently `headerSlot={undefined}`, TagView.tsx:47). `tag` is
   already in scope from useParams.
4. **TrashView Empty Now button:** TrashView renders `<ContentHeader title="Trash" />`
   directly (no ContentFrame/headerSlot today). Add a header action slot: pass a
   button as `ContentHeader`'s children (ContentHeader already renders `children`
   as the right-aligned slot — same slot Library uses). The button uses
   `HeaderActionButton` chrome with a trash-bin icon (reuse `DockTrashIcon` or a
   NavIcons trash glyph) + label. Behavior: **two-state inline confirm** — the
   button starts as "Empty Now" (trash icon); the FIRST click flips the SAME
   button in place to "✓ Confirm?" (check-mark icon + "Confirm?" label); clicking
   THAT (second click) calls `useEmptyTrash().mutate()`. NO separate cancel
   control — a single `useState(confirming)` toggles the two states, and the
   confirm state auto-resets (on blur, or a short timeout, or the next render
   after the mutation settles). Disable while `isPending`. Only show the button
   when there ARE trashed links (`links.length > 0`) — no point emptying an empty
   trash. Leave the existing idle-dock "Empty all" as-is (both surfaces fine).
5. **Context-aware Cmd+V:** `usePasteCapture` gains a `currentTag?: string`
   param. In AppFrame, derive it via `useMatch('/tags/:name')?.params.name` (or
   decode from `useLocation().pathname`), pass into `usePasteCapture(currentTag)`.
   The capture call becomes `captureLink.mutate({ url: text, tags: currentTag ? [currentTag] : undefined })`.
   Add `currentTag` to the effect deps. On non-tag routes currentTag is
   undefined → unchanged Library capture. (Trash route: currentTag undefined →
   Library capture, matching decision #2's "paste on trash still saves to Library".)
6. **Optimistic insert on tag pages:** verify `insertOptimisticLink`/
   `buildOptimisticLink` (hooks.ts) carry `input.tags` onto the optimistic row
   so it appears in the tag-scoped cache immediately. If they don't, thread tags
   through so the new row shows on the tag page without waiting for refetch.
   (If this is non-trivial, the `onSettled` invalidation still makes it correct —
   just not instant; note it, don't over-engineer.)

## Files
- NEW `packages/web/src/components/HeaderActionButton.tsx` — extracted chrome.
- `packages/web/src/routes/LibraryView.tsx` — `PasteCaptureButton` uses
  `HeaderActionButton`, gains `tags?` prop (Library passes none).
- `packages/web/src/routes/TagView.tsx` — pass `headerSlot={<PasteCaptureButton tags={[tag]} />}`.
- `packages/web/src/routes/TrashView.tsx` — Empty Now button (two-step confirm)
  in the ContentHeader children slot.
- `packages/web/src/lib/usePasteCapture.ts` — `currentTag?` param.
- `packages/web/src/components/AppFrame.tsx` — derive current tag via useMatch,
  pass into `usePasteCapture`.
- possibly `hooks.ts` — optimistic insert tags (only if needed).
- A NavIcons trash glyph if `DockTrashIcon` isn't reusable at this size.
- Tests: TagView capture applies tag; TrashView Empty Now two-step confirm calls
  useEmptyTrash only on 2nd tap; usePasteCapture passes tags when on a tag route.

## Verification
- `pnpm --filter @silo/web test` + `check-types` + `quality` green.
- Lead does browser QA (user will also eyeball, login-gated): tag page Add tags
  the link; Empty Now needs two taps; paste on tag page tags; paste on trash →
  Library.

## Guardrails
- Web-only. No API/core/db changes (all plumbed). Match Oat design; reuse the
  existing pill button style + `@media(hover:hover)`. No new dependency. No
  window.confirm (use the inline two-step). No logging clipboard content.
- Empty Now is destructive+irreversible → the two-step confirm is REQUIRED, not
  optional. Commit as one unit on `feat/search-url`; do not push.
