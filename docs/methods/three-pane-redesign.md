# Method: three-pane redesign of the web app

**Approved direction:** Amit approved the clickable prototype on 2026-10-25
(layout A, orange tile mark). This file is the spec and the build plan.
**Branch:** `feat/three-pane-redesign`, worktree `.claude/worktrees/three-pane`.
**Builder:** Codex Sol (`gpt-6.1-sol`, priority tier), by Amit's direction. This
overrides the "Sonnet builds" default for this slice only. The lead (Opus)
plans, reviews, and integrates.
**Rules:** `docs/rules/` (read `web-react.md`, `typescript.md`, `testing.md`
before the first edit). `exactOptionalPropertyTypes` is on.

## Source of truth for the look

- `docs/design/prototypes/silo-redesign.src.html` - readable prototype source
  (CSS at the top, render functions below). Port its CSS values, spacing,
  icons, copy, and behavior. Do not copy its string-template architecture.
- `docs/design/prototypes/silo-redesign.html` - the same prototype with fonts
  inlined. Open it in a browser to compare.
- Where the prototype and the current app disagree on **features**, the current
  app wins: keep every feature that ships today. Where they disagree on
  **look and layout**, the prototype wins.

## Frozen decisions

1. **Design system change (replaces "Oat").** Crisp neutral tokens from the
   prototype `:root` and `[data-theme="dark"]` blocks (`--bg #f6f6f5`,
   `--panel #fff`, `--line #e6e6e4`, `--ink #0c0c0b`, `--mut #5c5c59`,
   `--fnt #8a8a86`, `--btn #111110`, accent `#ffb23f -> #ff6a13`, dark
   `--bg #0a0a0a`, `--panel #111`, `--ink #f3f3f2`, and the rest). Geist
   400/500/600: 600 for pane titles, reader `h2`, and buttons where the
   prototype uses it. Keep token names where a current token maps 1:1, rename
   only when the meaning changes, and remove dead tokens.
2. **Brand.** The orange tile mark from the prototype `mark()` replaces the
   Stack mark everywhere: in-app brand, favicon set, PWA icons, `app-icon.svg`
   (regenerate rasters with `pnpm --filter @silo/web gen-icons`), and
   `docs/design/app-icon/`. The accent gradient may fill the mark, the primary
   "Add link" focus accents the prototype shows, and toasts' action text.
   Primary buttons stay `--btn` (ink), as in the prototype.
3. **Layout: three panes.** `sidebar | list | reader`, full-bleed (drop the
   centered 60rem band). Width modes by CSS container width, with CSS media
   queries for layout (no JS layout branch for first paint):
   - **wide >= 1100px:** sidebar docked, list (~380px) and reader side by side.
   - **mid 720-1099px:** sidebar is an off-canvas drawer opened from the list
     header; list and reader side by side.
   - **narrow < 720px:** list fills the screen; selecting a link shows the
     reader full screen with a back button and the bottom toolbar
     (prev, next, copy, edit, trash or restore). The sidebar is a drawer.
   - `[` collapses or shows the docked sidebar at wide; persist in
     `localStorage`.
4. **Selection lives in the URL** as `?link=<id>` on `/`, `/tags/:name`, and
   `/trash`. Selecting pushes history, so browser back on a phone returns to
   the list. The reader resolves the link from the loaded list pages first,
   then from `GET /api/links/:id` (add a `useLink(id)` hook) for a deep link.
   Trashed links resolve from the trash list. An unknown id shows the empty
   reader, not an error page.
5. **Reader pane.** Header: close, prev, next | Reader/Original segment |
   copy, edit, open original, trash (or restore in trash). Body: title,
   source line (letter chip, site, relative time, `◆ Added by Claude` when
   `addedBy === 'agent'`, `Capturing` while `enriching`), note card (click to
   edit) or "Add a note", tag pills (click navigates, `+` opens edit on tags),
   then content:
   - `sourceData.kind` `twitter` -> tweet card; `hacker_news` -> points and
     comments card; `github` -> stats card; `youtube` -> thumbnail through
     `/api/preview-image` plus channel.
   - Otherwise `extractedText` split on blank lines into `<p>` as plain text
     (never `dangerouslySetInnerHTML`). Fall back to `description`.
   - `enriching` -> the prototype skeleton and the `◌` line.
   - `partial`/`bare` with no text -> a calm line plus "Retry capture"
     (`useRetryCapture`).
   - Trash: the trash strip (purge countdown, Restore, Delete forever) above
     the same reader body. The Trash page never shows an empty reader while a
     link is selected.
6. **Original tab.** Silo has no `embeddable` field yet. Render the iframe
   (`sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`,
   `referrerpolicy="no-referrer"`, `loading="lazy"`) under a bar that always
   shows the path and "Open in new tab", plus one muted line: "Blank page?
   Some sites block embedding. Open it in a new tab." The prototype's
   blocked-site card is unit 4 (server-side check), not this build.
7. **Keyboard.** Keep every current shortcut. Add the prototype set:
   `j`/`k`/arrows move selection, `Esc` closes reader (then other layers by
   current priority), `e` edit, `o` open original, `c` copy URL, `r` toggle
   Reader/Original, `Backspace`/`Delete` trash (restore is not bound),
   `n` new link (focus capture), `[` sidebar, `/` and `⌘K` palette. Ignore
   shortcuts while typing in an input, textarea, or contenteditable.
8. **Surfaces to restyle, not rebuild:** command palette (new footer with
   key hints from the prototype), row menu (also on right click), edit modal
   (bottom sheet at narrow), settings modal (header with title and close above
   the tab strip at narrow; all four tabs keep their behavior), selection
   dock, toasts (with Undo where the app has it today), login gate, empty and
   error states, not-found view, skeletons.
9. **Features that must survive** (inventory the code; this list is a floor):
   paste-anywhere capture and the paste button, palette search and scopes
   including trash search, infinite scroll and prefetch, hover preview (behind
   its preference), multi-select and bulk trash/restore/delete, retry capture,
   tag create/delete/rename flows, theme sync with settings, plugins tab,
   preferences, import/export, access tokens, OAuth clients, MCP setup dialog,
   auth gate, error boundary, dev tools.
10. **Privacy holds:** no third-party request per row. Letter chips, not
    remote favicons. Images only through `/api/preview-image`.

## Units (one commit each; the lead reviews between units)

### Unit 1 - tokens, fonts, brand
- Replace `src/styles/tokens.css` values; add Geist 600 (latin woff2,
  self-hosted, same pattern as `fonts.css`). Keep both themes and the
  pre-paint theme script.
- New mark component replacing `GrainDot` usage as the brand mark; new
  favicon/PWA/app icons.
- Update `docs/design/tokens.md` (new section "Redesign 2026-10" that states
  what replaced Oat and why), the "Design fidelity" paragraph in `CLAUDE.md`,
  and the "Layout (the frame)" section in `docs/rules/web-react.md`.
- The current layout may look odd with new tokens after this unit; that is
  fine. Tests and gate must pass.

### Unit 2 - three-pane shell and reader
- `AppFrame` -> sidebar | list | reader with the three width modes, drawer,
  `[` collapse, URL selection, reader pane, Original tab, keyboard set,
  narrow bottom toolbar. Sidebar per the prototype: Search (⌘K), Library,
  Trash with counts, Tags with `+`, tag rows with counts, theme toggle and
  Settings at the bottom.
- List rows per the prototype `rowHtml`: letter chip, title, domain line,
  `Capturing`, purge text in trash, note line, `⋯` button. Day groups stay.
- Keep `LibraryView`/`TagView`/`TrashView` as the list owners; extract shared
  reader code into `src/components/reader/`.

### Unit 3 - restyle the other surfaces
- Everything in decision 8, matched to the prototype at all three widths and
  both themes.

### Unit 4 - embeddable check (separate follow-up, not in this build)
- Capture records whether the page allows framing (`X-Frame-Options`, CSP
  `frame-ancestors`); the API exposes `embeddable: boolean | null`; the
  Original tab shows the blocked-site card when `false`. Needs its own method
  section and a migration; the lead writes it after unit 3 lands.

## Tests

- Update tests that assert Oat values or the old layout; delete tests only for
  removed code. New tests: URL selection and back behavior, reader content
  per `sourceData.kind`, extracted-text paragraphs render as text, trash
  reader actions, keyboard shortcuts (including "ignored in inputs"), Original
  tab iframe attributes, narrow toolbar actions.
- Mock `fetch` as today. No real network in web tests.

## Done for each unit

1. `pnpm turbo run check-types test` and `pnpm quality` pass from the worktree.
2. `pnpm --filter @silo/web build` passes.
3. One commit per unit, staged by explicit path, message ends with
   `Co-Authored-By: Claude <noreply@anthropic.com>` (project rule in `CLAUDE.md`).
4. Report: commit SHA, files changed, what you checked, anything you could
   not match to the prototype, and any feature you could not keep.
