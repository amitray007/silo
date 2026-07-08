# Plan 024 — command center (floating search palette) + paste-only omnibar

**What:** a floating, keyboard-first command-center search (⌘K + a `/` sidebar
"Search" item), modeled on shiori's palette, that searches links + `#tags`. The
top omnibar becomes **paste-only**. User-picked design.

## Locked spec (from discussion — do not re-litigate)
- **Trigger:** ⌘K (a handler already exists in `useOmnibarState.ts`) AND a
  sidebar **Search** nav item with a `/` shortcut hint (matches the reference).
  Both open the centered floating palette.
- **Palette UI:** a centered overlay (scrim-dimmed) with a search input at top
  ("Search links…") + a live result list below (favicon + title, like the
  reference image), keyboard-navigable (↑↓ move, Enter act, Esc close). Uses the
  new floating-panel surface treatment (hairline edge, --bg2 surface, radius —
  consistent with the just-shipped dark-craft look).
- **Query model (parse the input):**
  - `react` (plain text) → text search (`GET /api/links/search?q=react`).
  - `react #frontend` (text + tag) → text AND tag
    (`GET /api/links/search?q=react&tag=frontend` — the extended API below).
  - `#frontend` (tag only, no text) → ALL links with that tag
    (`GET /api/links?tag=frontend`, the existing list route).
  - Typing `#jan…` → AUTOCOMPLETE matching tag names from `GET /api/tags`
    (`useTags()`), shown as pickable suggestions; picking one completes/applies
    the tag filter.
- **Result behavior:** Enter on a link result → open its url in a NEW TAB (same
  as a row click). Enter on a tag suggestion → applies the tag filter (does NOT
  open a page).
- **Omnibar:** slimmed to paste-only ("Paste a link to keep") — its inline
  search role moves entirely to the palette. Keep paste-to-capture.

## Unit 1 — extend the search API (small: core + api)
- `GET /api/links/search` currently takes only `q` (`routes/links.ts:41`, schema
  `q: z.string().min(1)`). Add an OPTIONAL `tag` param: when present, the search
  is scoped to links carrying that tag (text-AND-tag). The tag-filter logic
  already exists for `core.list`'s `{ tag }` filter (`routes/links.ts:71`) — reuse
  the same predicate in the search path (core's search fn gets an optional tag
  filter, or the route composes search + the live tag join). Keep `q` required
  (empty q is still a 400); `tag` is the additive scope.
- Update the query schema + core search signature + tests (search with tag scopes
  correctly; without tag behaves exactly as before — regression).

## Unit 2 — the command palette (web)
- New `CommandPalette.tsx` (+ a `useCommandPalette` state hook, or fold into the
  existing `useOmnibarState`): mounted once at the app root (like the hover
  preview / row menu providers). Opens on ⌘K and on the sidebar Search click.
- **Input parsing** (`lib/parseSearchQuery.ts`, pure + tested): split the raw
  input into `{ text, tag }` — a trailing/embedded `#word` is the tag; the rest
  is text. Handle: text-only, `text #tag`, `#tag`-only, and a partial `#jan`
  (incomplete tag → drives autocomplete, not yet a filter).
- **Data:** reuse `useSearchLinks` (extend it to pass an optional tag →
  `?q=&tag=`), `useTags` (for `#` autocomplete), and the existing `?tag=` list
  fetch for the tag-only case. Debounce keystrokes (the omnibar already
  debounces — reuse the pattern).
- **Rendering:** favicon (the same `Chip`/favicon the row uses) + title per
  result; a highlighted active row; when the input is `#jan…`, show matching TAG
  suggestions instead of / above link results. Empty query → optionally show
  recent links or nothing (match the reference: it shows the full list when
  empty — decide; showing recent/all is friendly).
- **Keyboard:** ↑↓ move the active result, Enter acts (open link in new tab /
  apply tag), Esc closes, focus-trap while open, restore focus on close (reuse
  ModalShell's modality-aware focus if it fits, or a lightweight version).
  Open-in-new-tab = `window.open(url, '_blank', 'noopener')` (mirror the row's
  anchor semantics).
- Accessibility: role="dialog"/combobox listbox semantics, aria-activedescendant
  for the active option, labelled input. Reduced-motion respected.

## Unit 3 — omnibar → paste-only
- The omnibar (`Omnibar.tsx`) drops its inline-search behavior; placeholder
  becomes "Paste a link to keep" (no "· type to search"). Paste-to-capture
  stays. If the omnibar currently routes typed text to `useSearchLinks`, remove
  that path (the palette owns search now). Update `useOmnibarState` accordingly.
- Add the sidebar **Search** item (with the `/` hint) that opens the palette —
  place it per the reference (top of the nav, above Library). `/` as a global
  shortcut to open the palette (in addition to ⌘K) — guard so it doesn't fire
  while typing in an input.

## QA / gate / review (visual + behavioral)
- Screenshot the palette (open, empty; with text results; with `#tag`
  autocomplete; with `text #tag` results) in dark + light — matches the reference
  feel + the new dark-craft surface.
- Behavioral: `react` → text results; `react #frontend` → AND (verify against the
  extended API); `#frontend` → all tag links; `#jan` → tag suggestions; Enter
  opens a link in a NEW TAB; Esc closes; ⌘K and `/` both open; `/` doesn't fire
  while typing. Omnibar no longer searches (paste-only).
- `DATABASE_URL=… pnpm turbo run check-types test build --concurrency=1` +
  `pnpm quality` exit 0. Tests: the query parser (pure, all cases), the extended
  search API (with/without tag), the palette (open/close/nav/act, tag
  autocomplete, open-in-new-tab), omnibar-is-paste-only. Update omnibar tests
  that asserted inline search.
- Review: ce-frontend-design (the palette matches the reference + dark-craft
  surface), ce-correctness (query parsing edge cases: multiple #, # mid-word,
  empty; the AND search), ce-api-contract (the extended search route preserves
  the q-only behavior), a11y lens. Resolve all.
- Commit on a slice branch; do NOT push/merge — the user's eye gates the palette
  (show screenshots).

## Sources
- `packages/api/src/routes/links.ts` (search route + the `?tag=` list filter to
  reuse), `packages/core/src/links/search.ts` (+ `list.ts` for the tag predicate),
  `packages/web/src/components/{Omnibar,AppFrame,Sidebar,Chip}.tsx`,
  `packages/web/src/lib/useOmnibarState.ts` (the ⌘K handler + debounce),
  `packages/web/src/api/hooks.ts` (`useSearchLinks`/`useTags`/`useInfiniteLinks`),
  `packages/web/src/components/ModalShell.tsx` (focus-trap/modality pattern),
  the two reference images (palette + sidebar), `docs/design/tokens.md`.
