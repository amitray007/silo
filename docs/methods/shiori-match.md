# Method: match shiori.sh's app UI

**Request (Amit, 2026-10-25):** match shiori.sh "exactly": sidebar, buttons,
font, font weights, rows, menus, dialogs, settings. Copy how they do it.
**Branch:** `feat/shiori-match`, from `feat/reader-original`.
**Builder:** Codex Sol (priority tier). The lead (Opus) wrote this from a live
QA pass of the logged-in shiori app (Aside browser) and computed styles.

## Evidence

Reference screenshots (2880x1800, dark unless named) in `/tmp/shiori-look/`:
`01-inbox.png` list, `02-reader-top.png` reader, `04-row-hover.png` hover
actions, `07-reader-more.png` the `+` add popover, `08/09-search*.png` search,
`10-inbox-dropdown.png` collection menu, `13-settings.png`,
`14-settings-reader.png`, `15-settings-prefs.png`, `16-reader-code.png`,
`17-original.png`, `light.png` (light theme demo), `landing.png`.
Raw computed styles: `/tmp/shiori-look/p1.json`, `p2.json`, `qa3.json`.
Shiori CSS: `/tmp/shiori-css/pretty-*.css`.

Open the reference PNGs before each unit and compare side by side with silo
screenshots at the same 1440x900 viewport. "Match" means the same sizes,
weights, colors, spacing, radii, and shadows, not "similar".

## Keep (silo identity and features)

- The orange tile brand mark. Silo's features and routes (library, tags,
  trash, capture, edit, notes, retry, selection, settings tabs, MCP setup,
  tokens, OAuth clients, plugins, import/export). Live/Reader tabs.
- Privacy: no third-party request per row from the browser. Real favicons
  through silo's `/api/favicon` proxy, styled as shiori's (20px, radius 4px).
- Do not copy shiori's AI features (chat box, Summarize, auto-tagging), feeds,
  favorites, archive, or Pro badges. Silo has no AI inside.

## Tokens (replace values in `src/styles/tokens.css`; keep token names)

Use oklch values directly. Neutral palette (Tailwind neutral):
`50 oklch(99.11% 0 0)`, `100 97%`, `200 92.2%`, `300 87%`, `400 70.8%`,
`500 55.6%`, `600 43.9%`, `700 37.1%`, `800 26.9%`, `900 20.5%`, `950 14.5%`.

| Role (silo token) | Light | Dark |
| --- | --- | --- |
| ground, all three panes (`--bg`) | 50 | 950 |
| raised panel, menus, dialogs (`--bg2`) | mix(50 50%, white) | 900 |
| secondary fill, hover, code bg (`--hov`) | 100 | 900 |
| selected row/nav (`--sel`) | mix(100, 950 4%) = oklch(93.7% 0 0) | mix(800, 50 5%) = oklch(30.5% 0 0) |
| menu item highlight | 100 | 800 |
| line (`--line`) | mix(200, 950 2%) = oklch(90.6% 0 0) | mix(800, 50 2%) = oklch(28.3% 0 0) |
| ink (`--ink`) | 950 | 100 |
| secondary text (`--mut`) | 600 | 400 |
| tertiary text (`--fnt`) | 500 | 500 |
| quaternary text (new `--ghost`) | 400 | 600 |
| segment "on" chip | mix(50 50%, white) + `0 1px 2px` 400@25% | 700 + `0 1px 2px` 950@40% |

Quaternary text fails WCAG AA. Shiori uses it only for counts, day labels,
and kbd hints; do the same and record the trade-off in `docs/design/tokens.md`.

Shadows (light / dark), from shiori's `--control-shadow` and `--popup-shadow`:
- control: `0 0 0 .5px 600@20%, 0 1px 1px -1px 700@10%, 0 2px 2px -1px 700@6%,
  inset 0 1px 0 50@70%` / `0 0 0 .5px 950@70%, 0 1px 2px 950@30%,
  inset 0 .5px 0 200@10%, inset 0 0 0 .5px 200@5%`.
- popup (menus): `0 0 0 .5px 600@20%, 0 2px 4px -1px 700@8%, 0 6px 12px -3px
  700@8%, 0 16px 32px -8px 700@10%` / `0 0 0 .5px 950@70%, 0 2px 4px -1px
  950@30%, 0 6px 12px -3px 950@40%, 0 16px 32px -8px 950@50%, inset 0 0 0 .5px
  200@6%`.
- dialog (search, modals): dark `inset 0 0 0 .5px rgba(255,255,255,.04), inset
  0 .5px 0 rgba(255,255,255,.04), 0 1px 3px 950@40%, 0 2px 12px 950@70%`;
  light uses the popup shadow.
- Dividers are `0.5px solid var(--line)` everywhere (pane borders, header
  bottoms, settings rows).

## Type

- Font: system stack `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji",
  "Segoe UI Emoji"`, `subpixel-antialiased`. Remove self-hosted Geist
  (`fonts.css`, the woff2 files, imports, preload tags). Mono:
  `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
  monospace`.
- Weights: 400 body and nav, 500 row titles, pane titles, segment, menu items,
  section labels, buttons; 600 reader title and reader h2.
- Update `CLAUDE.md` "Design fidelity", `docs/rules/web-react.md` (fonts line),
  and `docs/design/tokens.md` (new section "Shiori match 2026-10-25").

## Layout

- Three flat full-bleed panes on `--bg`: sidebar 240px, list 384px, reader
  flex. Each separated by a `0.5px` right border. Remove silo's inset content
  card (rounded, bordered `.silo-content` panel); nothing floats.
- Optional last unit: drag handles ("Resize sidebar", "Resize list column")
  to resize the sidebar and list, persisted in localStorage.

## Sidebar (`AppFrame`, `NavItem`, sidebar CSS)

- Top: brand mark at left (24px), collapse icon button at right; row height 44.
- Groups have padding `4px 8px`, gap 2px. Nav rows: height 32, radius 6,
  padding `0 8px`, gap 8, icon 16 in tertiary, text 14/20 weight 400.
  Idle text secondary; hover bg `--hov`; active bg `--sel`, text ink.
- Counts: 12px, quaternary, tabular-nums, right aligned.
- Search row: same row with a kbd chip at right: 11px/500, quaternary, bg
  `--hov` at 50%, ring 0.5px line, radius 4, padding 4. Silo shows `⌘K`.
- Section header ("Tags ▾"): button 13/500 tertiary, padding `2px 8px`,
  radius 6, gap 6, small ▾ caret, collapsible (persist open state). 25px top
  margin. Tag rows: same as nav rows with a `#` icon in tertiary. Last row
  "+ New tag" in tertiary.
- Bottom group: Settings (sliders icon), theme toggle. Same row style.
- Library and Trash: copy shiori's collection menu. The sidebar shows Search
  and Library (count). The list header title is a dropdown button
  ("Library ⌄", 14/500) with a menu of Library and Trash (with counts). Tag
  views show "#tag" as the title without the dropdown.

## List pane (`LibraryView`, `TagView`, `TrashView`, `LinkRow`, `DayGroup`)

- Header: height 44, padding `0 8px 0 16px`, bottom 0.5px line. Title left.
  At right one `+` icon button (32px, radius 8, tertiary). It opens a popover
  (popup style) titled "Paste to save" with the hint "Press ⌘V anywhere on
  this page to save a link." and silo's URL input below. Keep paste-anywhere.
- Body padding 12px. Day label: 14px/20 quaternary, padding `12px 12px 4px`.
- Rows (compact, the default): height 44, radius 8, padding `0 8px 0 12px`,
  gap 12. Chip 20px radius 4. Title 14/20 weight 500 ink, one line, ellipsis.
  Hover bg `--hov`; selected bg `--sel`. On hover or selection, show three
  32px icon buttons at the right (radius 8, tertiary): Open original (↗),
  Move to trash, More (⋯, opens the existing row menu). Trash rows show
  Restore instead of trash.
- Silo-only state stays visible without breaking the row height: capturing
  shows the existing shimmer; a note shows as a small note icon before the
  hover actions.
- Preference "Compact links" (default on) in Settings > Preferences. Off
  restores the two-line row (domain line, note line) in the same type scale.
- Multi-select keeps working (checkbox replaces the chip on hover in select
  mode).

## Reader pane (`ReaderPane`, `ReaderMeta`, prose CSS)

- Header: height 44, grid `1fr auto 1fr`, padding `0 8px`, gap 8, bottom 0.5px
  line. Left: close, previous, next (32px, radius 6, tertiary icons). Center:
  segment (bg `--hov`, radius 8, padding 2, gap 2; buttons 13/500, padding
  `4px 10px`, radius 6; on chip per tokens table; off text tertiary). Right:
  silo's actions as 32px radius-6 icon buttons, then ⋯.
- Article: `max-width: 700px`, padding `48px 32px 128px`, centered.
- Title: 30px/1.25, weight 600, letter-spacing -0.75px, ink, `text-wrap:
  pretty` (24px under 640px). Site line: 16px chip + domain, 14px tertiary,
  12px below the title.
- Silo's note card takes shiori's summary card look: bg `--hov`, radius 16,
  padding `12px 16px`, label 13/500 tertiary, text 15/1.75 secondary; 32px
  above it. Tags sit with the site line.
- Prose: 15px/1.75, secondary color; p margin `0 0 16px`; h2 20px/1.33 weight
  600 letter-spacing -0.5px ink, margin `40px 0 20px`; h3 17px weight 600;
  links ink, underline, offset 2px; inline code bg `--hov`, radius 4, padding
  `2px 6px`, 0.85em weight 500 ink; pre bg `--hov`, radius 8, padding `14px
  16px`, 13px/22px system mono, no border; lists outside markers tertiary.
  Code uses the system mono stack in `--font-mono`; Inter made code blocks
  read as prose (changed 2026-10-26).
- Live tab iframe: keep silo's sandbox and silo-view logic. Do not copy
  shiori's `allow-scripts allow-same-origin` sandbox.

## Menus and dialogs (`MenuSurface`, `RowMenu`, `CommandPalette`, `ModalShell`)

- Menu: bg `--bg2`, popup shadow, no border, radius 8, padding 4, gap 1px,
  min-width 160. Items: height 32, padding `6px 12px`, radius 5, gap 8,
  13/500 ink, icon 20 box; highlight bg (menu item highlight token). Enter
  `scale(.95)→1`, opacity, 150ms `cubic-bezier(.16,1,.3,1)`; exit 100ms
  ease-in.
- Search palette: fixed `top: min(20vh, 200px)`, width `min(90vw, 672px)`,
  radius 12, bg `--bg2`, dialog shadow. Input row height 44, 14px, search
  icon at left, placeholder tertiary. Results: rows height 40, radius 8,
  14px, chip 20 at left; selected bg (menu item highlight). Backdrop: no dim,
  `backdrop-filter: blur(8px)` only.
- Modals (edit, confirm, MCP setup): radius 12, dialog shadow, backdrop blur
  4px with scrim (light `100 @80%`, dark `950 @90%`); enter `scale(.96)→1`
  200ms `cubic-bezier(.16,1,.3,1)`.

## Buttons

- Primary: height 32 in app (40 on auth/landing), padding `0 12px`, radius 8,
  14/500. Light: bg 950, text 50. Dark: bg 200, text 900.
- Secondary: bg `--hov` light / 800 dark, control shadow, ink text.
- Ghost icon: 32px, radius 6 or 8 as listed, tertiary icon, hover ghost bg
  (ink 8%).

## Settings (copy shiori's page layout)

- Settings becomes a route `/settings/:tab` (keep deep links that opened the
  modal working by redirecting). The list column shows the settings nav
  (title "Settings" in the 44px header; items as nav rows); the reader area
  shows the tab with a 44px header holding the tab name.
- Content: centered column `max-width: 616px`, padding-top 24. Rows: padding
  `16px 0`, bottom 0.5px line, title 14/500 ink, description 14px tertiary,
  control at right. Toggle switch: 36x20, on-color `oklch(62.3% .214 259.8)`
  (blue-500), white knob. Select: height 32, radius 8, bg `--hov`, 14/500.
- Every current tab keeps its behavior (plugins, preferences, import/export,
  tokens, OAuth, MCP). Add Preferences: "Compact links".

## Units (one commit each)

1. Tokens, type, shadows, font swap, docs.
2. Flat three-pane frame, sidebar, collection dropdown.
3. List header, `+` popover, compact rows, hover actions, Compact preference.
4. Reader header, article, note card, prose.
5. Menus, search palette, modals, buttons, motion.
6. Settings page route.
7. (Optional) resizable sidebar and list.

## Done for each unit

- Screenshots of silo at 1440x900 in dark and light next to the matching
  shiori reference; list every remaining visual difference in the report.
  Also check 390x844 (phone) and 900px (mid) still work.
- `pnpm turbo run check-types test` and `pnpm quality` pass; `pnpm --filter
  @silo/web build` passes. Update tests for changed markup; keep behavior
  tests.
- Use the QA API on port 8787 (database copy `silo_redesign_qa`). Never touch
  the real `silo` database.

## Pass 2: exact copy (2026-10-26)

Amit: keep analyzing and copy shiori exactly (sidebar, icons, buttons,
modals, popovers, command palette, search and input boxes, alignment,
padding, font, size, weight, spacing). Do not copy shiori's settings: restore
silo's settings modal.

**Source of truth.** Shiori is Tailwind v4 plus Base UI, so each element's
class list is its style recipe. Captured from the logged-in app:
- Class-annotated HTML (svg paths truncated): `/tmp/copy-spec/sidebar.html`,
  `list.html`, `reader.html`, and `clean-*.html` for the add popover,
  collection menu, row More menu, reader More menu, command palette (empty and
  typed), and the feedback modal (the reference for silo's modals).
- Computed values: `/tmp/copy-spec/shiori-s1.json` (sidebar),
  `shiori-s2.json` (list, rows, reader header).
- Screenshots, dark and light: `/tmp/copy-spec/shots/`.
- Utility definitions (`focus-ring`, `shadow-control`, `ring-border`,
  `bg-elevated-secondary`, `text-icon-*`, and the rest):
  `/tmp/shiori-css/pretty-globals-Dqh-4ozJ.css`.

**Corrections to pass 1.**
- Font is Inter Variable on every element (`* { font-family: Inter
  Variable, Inter, sans-serif }`), not the system stack. Self-host it (for
  example `@fontsource-variable/inter`, OFL); no third-party font requests.
- Icons are 20px boxes, `viewBox="0 0 24 24"`, stroke 1.5, round caps and
  joins, `currentColor`. Match that style. Do not copy shiori's path data;
  redraw silo's icons on that grid or use a permissive set such as Lucide at
  stroke 1.5.
- Sidebar rows are `h-8 px-2 py-1.5 gap-2 rounded-md text-sm`; icon 20px.
  Section headers `text-[13px] font-medium` tertiary with a 10px filled caret;
  section block `mt-3`. Groups `px-2 pt-1 pb-2 gap-0.5`. Top bar 44px with the
  logo link `p-1 rounded-full` and a collapse button that shows only on
  sidebar hover.
- Buttons: `rounded-lg`, `font-medium`, `motion-safe:active:scale-[0.96]`,
  `focus-ring` (2px tertiary outline, offset 2). Icon buttons `size-8`,
  tertiary, hover `palette-200` light / `palette-800` dark.
- Row hover bg is `oklch(23.3% 0 0)` in dark; selected `oklch(30.5% 0 0)`.
- Reader body text in the app is 16px/28px secondary (not 15px).
- Menus: two recipes. Collection menu: `p-1 gap-px rounded-lg min-w-40`,
  items `h-8 px-3 py-1.5 text-[13px] font-medium rounded-[5px]`. Context
  menus (row and reader More): `py-1.5 rounded-lg ring-border shadow-md`,
  items `mx-1.5 px-2 py-1.5 text-sm rounded-lg gap-2.5`, icon 20px, 0.5px
  separators `my-1.5`, danger item red.
- Command palette: copy `clean-cmdk-*.html` exactly (layout, input row,
  result rows, scroll area, backdrop).

**Settings.** Restore silo's settings modal and its tabs as they were before
unit 6 (commit 2020e44 has the original). Remove the `/settings/:tab` page
route and redirect any `/settings` URL to open the modal. Keep the "Compact
links" preference inside silo's Preferences tab. Silo's modal may use the new
tokens, font, and controls.
