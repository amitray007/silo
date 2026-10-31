# Method: Reader tools

## Why

The Reader is now strong enough that people read whole articles in silo. They
need the controls a native reading app gives: a comfortable type setting, a
pace guide that remembers where they stopped, highlights with passage notes,
and a natural read-aloud voice.

The owner validated the design in a throwaway prototype on the
`prototype/reader-tools` branch (dev-only code under
`packages/web/src/components/reader/prototype/`). That branch is the primary
source for look and feel. Production code is a rewrite under the project
rules, not a copy.

## Slices

Each slice is a vertical slice with its own plan section, gate 1, build, review
and gate 2. Later sections are written when their slice starts.

| Slice | Ships | Persistence |
| --- | --- | --- |
| 1. Dock + Type | Bottom dock with the Type sheet: font, size, line height, width, theme | Browser-local |
| 2. Outline + Pencil | Outline dial, reading pencil (underline / highlighter), resume point | Resume point on the server, MCP-readable |
| 3. Highlights + passage notes | Selection toolbar, overlapping layers, note popover, notes lane, theme palette | Server table, API, MCP tools |
| 4. Read aloud | Kokoro and Phonon in workers, smart segmentation, gapless queue, Listen sheet | Model files served by silo; voice choice browser-local |

## Frozen decisions (all slices)

1. **Layout: the bottom dock (prototype variant B).** A floating pill at the
   bottom centre of the reader pane. Each tool opens a sheet above the dock.
   The dock only lists tools that have shipped. No disabled placeholders.
2. **Scope of the dock.** Reader tab only, and only when the link renders
   `ReaderProse` (readable article HTML). The Original tab keeps the existing
   View settings button and its live-page "Dark page" toggle.
3. **No helper text.** Controls carry `title` tooltips for shortcuts. Sheets
   hold controls only.
4. **Custom controls only.** No native `<select>`. Reuse silo's listbox
   (`SettingsTabs/SettingsSelect.tsx`) pattern, the segmented radio pattern,
   `MenuSurface` / `MenuPresence`, `Skeleton`, and `loading-dev` spinners.
5. **The link-level `notes` field stays.** Passage notes (slice 3) are a
   separate table. `future-scope.md` is updated in slice 3.

## Slice 1: Dock + Type

### Scope

- `ReaderDock`: the floating pill, holding one tool for now: **Type** (`Aa Type`).
- `TypeSheet`, opened from the dock, with five rows:
  - **Font**: Inter (default), Literata (serif), Mono (`--font-mono`).
  - **Size**: a `- 16 +` stepper, 14 to 24 px, step 1.
  - **Line height**: Compact 1.5, Normal 1.75 (default), Relaxed 2.
  - **Width**: Narrow, Medium, Wide (the existing setting, moved here).
  - **Theme**: Default, Sepia.
- On the Reader tab, remove the sliders button from the reader head. Width now
  lives in the Type sheet. The Original tab is unchanged.
- Settings apply live to the article prose and persist per device.

### Out of scope

Pencil, outline dial, highlights, notes, read aloud, selection toolbar,
keyboard shortcuts for type settings, and server-side preferences. Type
settings are presentation, so the MCP surface does not change.

### Design

- **Dock.** Matches the prototype: pill, `--bg2` surface, `--elev-2` shadow,
  38px buttons with icon and label at 500 weight, centred 20px above the pane
  bottom. On phones (`layoutMedia.phone`) it sits above the bottom action
  toolbar, clear of the safe area (`env(safe-area-inset-bottom)`), and shows
  icon and label (only one tool, so it fits).
- **Sheet.** A `MenuSurface` anchored above the dock, 360px wide (full width
  minus 24px on phones). Rows are label left, control right, and never
  truncate. Escape closes the sheet first, then normal reader Escape rules
  apply.
- **Theme.** "Default" follows the app's light or dark theme. "Sepia" sets
  pane-scoped tokens on `.silo-readerpane[data-reader-theme="sepia"]`, with a
  light and a dark variant. Start from the prototype values in
  `prototype.css` (search `data-proto-theme`). Body text keeps at least 4.5:1
  contrast in both variants. The head and the dock recolour with the pane.
- **Prose scaling.** `.silo-reader-prose` reads three custom properties:
  `--reader-font`, `--reader-size` (px) and `--reader-leading` (unitless).
  Body `line-height` becomes unitless. Heading sizes become ratios of
  `--reader-size` that reproduce today's values at 16px (h1 26/16, h2 20/16,
  h3 17/16, h4 and h5 1, h6 14/16). Code blocks, tables and captions scale
  with the same ratio they have today. At the defaults, the Reader must render
  pixel-identical to `main`.
- **Fonts.** Add `@fontsource-variable/literata` (OFL-1.1, self-hosted, which
  the design rules require). Import it once in `main.tsx` next to Inter. The
  browser downloads it only when the serif font is used.

### Implementation plan

1. **Preference store.** Generalise `lib/useReaderWidth.ts` into
   `lib/readerPrefs.ts`: one `useSyncExternalStore`-backed store for a
   versioned JSON value under `silo.readerType`
   (`{ font, size, leading, theme }`), with the same memory-only fallback and
   cross-tab `storage` sync. Validate on read, and fall back per field to the
   defaults on bad data. Keep `useReaderWidth` and its `silo.readerWidth` key
   unchanged (existing users keep their width), re-implemented on the shared
   helper so both prefs use one code path.
2. **Apply.** `ReaderPane` reads the prefs and sets the three custom
   properties on the prose container and `data-reader-theme` on the pane. No
   per-render style objects in hot paths: memoise the style.
3. **CSS.** Update `surfaces.css` prose rules as described above. Add the
   sepia token blocks. Add dock and sheet styles in a new `styles/reader-dock.css`
   (imported where the other style sheets are), using tokens only.
4. **Components** in `components/reader/dock/`:
   - `ReaderDock.tsx`: the pill and the open-sheet state. The tool list is a
     typed array so later slices add entries.
   - `TypeSheet.tsx`: the five rows.
   - `Stepper.tsx`: a generic `- value +` control, reused later by pencil
     speed and read-aloud speed. Buttons disable at the bounds and expose
     `aria-valuenow` through a spinbutton role on the value.
   - `Segmented.tsx`: extract the radio-group pattern from
     `ReaderSettings.tsx` (arrow keys, roving tabindex) and use it in both
     places, which removes the duplication.
5. **Mount.** Render `ReaderDock` from `ReaderPane` when the tab is `reader`
   and the content is `ReaderProse`. Remove the Reader-tab branch from
   `ReaderSettings` so it renders only for the Original tab.
6. **Remove nothing else.** The prototype branch stays separate and is not
   merged.

### Tests (`docs/rules/testing.md`)

- `readerPrefs`: defaults, round-trip, invalid JSON, out-of-range size,
  unknown font, storage throwing (memory fallback), and cross-tab events.
- `useReaderWidth`: existing tests still pass unchanged.
- `TypeSheet`: each control updates the store; stepper bounds; segmented
  keyboard behaviour; no truncation markup.
- `ReaderDock`: renders on the Reader tab with prose, does not render for the
  Original tab, tweets or video, and Escape closes the sheet before the
  reader.
- `ReaderSettings`: renders on Original only.
- CSS: a check that the default custom properties reproduce today's computed
  font sizes and line height.

### QA (real links, the `silo_reader_qa` database)

At 1440, 1100 and 390 px, in light and dark mode, on a long article, a
docs page, a page with code and tables, and a Wikipedia page:

- Every Type control applies live and survives a reload.
- At the defaults, the Reader matches `main` (side-by-side screenshots).
- Sepia is readable in both app themes, and the head and dock recolour.
- Literata and Mono render. No network request goes to a third-party font
  host.
- On the Original tab, View settings and "Dark page" work as before.
- On a phone, the dock clears the bottom toolbar and the safe area.
- Keyboard only: open the dock, use every control, and close with Escape.

### Done when

The quality gate passes (`pnpm turbo run check-types test` and
`pnpm quality`), the review protocol has run, QA passes, and the owner has
approved at gate 2.
