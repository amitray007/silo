# Responsive layout: match shiori

Copy shiori's layouts below 1440 px. Measured 2026-10-26 in Aside on the
logged-in test account at 1200, 1024, 900, 768, 640 and 390 px. Aside fixes
the viewport at 1440 px, so the probe rewrote each width media rule in the
page and clamped `html` and `body` to the target size. shiori's JavaScript
only checks `(hover: none)` and `(pointer: coarse)`, so CSS drives the layout.
Evidence: `/tmp/shiori-resp/` (probe scripts, `s-*.png`, `o-*.png`,
`m-390.png`) and the silo captures `silo-*.png`.

## shiori breakpoints

| Width | Sidebar | List | Open link |
| --- | --- | --- | --- |
| 1024 and up | 240 px, persistent | 360 px | Reader pane on the right |
| 641 to 1023 | 240 px, persistent | Fills the rest | Reader covers the whole window |
| 640 and down | None | Full width, 12 px gutters | Reader covers the whole window |

Details:

- **List header (all widths):** collection title "Inbox" with a chevron,
  14/500 at y 12; "Add link" 32 px button 6 px from the right edge.
- **Rows:** 44 px tall, padding `0 8px 0 12px`, title 14/20/500, at every
  width. On phones the list has 12 px side gutters.
- **Phone bottom bar:** a rounded pill, 358 x 56, 16 px from the sides and the
  bottom, padding 6 px. Three icon-only items, 115 x 44, icons 28 px: Home,
  Search, More. Active item uses the ink color, others the muted color. Home
  shows a small unread dot.
- **Phone "More":** a menu that opens upward from the bar, 192 px wide,
  radius 8, items 32 px: Favorites, Archive, Settings, Share feedback.
- **Phone row actions:** no visible per-row buttons on touch.
- **Full-window reader (below 1024):** 44 px header, buttons 32 px at y 6:
  Close, Previous, Next from x 8 with a 34 px pitch; on the right Show
  original, Archive, Favorite, More with the same pitch, ending 8 px from the
  edge. The content column is at most 636 px and centered; on phones it has
  20 px side padding. Body text 16/28.

## silo today (same widths)

- Sidebar turns into a drawer below 1100 px (`layout.css` `max-width: 1099px`,
  `AppFrame.tsx` `min-width: 1100px`), so 1024 to 1099 loses the sidebar.
- 720 to 1099: list 339 px plus the reader beside it. At 768 the reader is
  about 420 px wide and hides most actions.
- Below 720: 52 px header with a menu button, 6 px gutters, a "⋯" button on
  every row with a gray gradient box, the note icon crowding it, a round
  floating button at the bottom right, and a reader with "< Library", the
  Reader and Live tabs, and a bottom toolbar.

## Changes

1. **Breakpoints:** persistent sidebar at 641 px and up (drawer only at 640
   and below). Reader pane beside the list at 1024 and up; below 1024 the
   reader covers the whole window. Replace the 719/720 and 1099/1100 values in
   CSS and in `matchMedia` calls (`AppFrame`, `ReaderPane`, `ReaderLayout`)
   with 640/641 and 1023/1024. Put the queries in one shared module.
2. **Full-window reader below 1024:** shiori's header layout. Left: Close,
   Previous, Next. Right: the Reader/Live segment, then the actions that fit,
   then More. At 640 and down keep only the segment and More on the right and
   move Copy, Refresh, Edit, Open original and Trash into More. Remove the
   phone bottom toolbar. Content column max 636 px, centered, 20 px side
   padding on phones.
3. **Phone list:** 44 px header like the desktop pane head (title with
   chevron at the left, Add link 6 px from the right), 12 px list gutters,
   rows unchanged at 44 px.
4. **Phone bottom bar:** the shiori pill with three icon-only items: Library,
   Search (opens the command palette), More. More opens a menu upward with
   Trash, Settings and the theme toggle. Tags stay reachable from the Library
   collection menu; add them there if missing. Remove the floating round
   button and move its action into More. Pad the list bottom so the last row
   clears the bar.
5. **Touch rows:** under `(hover: none)` show no per-row action buttons and no
   gradient box. Long press opens the row menu through the existing
   `contextmenu` handler. Keep the note icon.
6. Keep silo's own features (tags, notes, Reader and Live) and silo's
   settings. Do not copy shiori's path data for icons.

## Tests and QA

- Unit: the shared breakpoint module; the reader header moves actions into
  More at phone width (mock `matchMedia`); bottom bar renders three items and
  More lists Trash, Settings and the theme toggle.
- Browser QA with agent-browser at 1440, 1200, 1024, 900, 768, 640 and 390
  in both themes: list, open link, close, previous and next, More menus,
  long press on a row. Compare with `/tmp/shiori-resp` captures.
