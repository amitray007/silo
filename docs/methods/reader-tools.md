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

## Working mode for slices 2 to 4 (owner decision, 2026-11-01)

The owner tests all slices at the end. Each slice still gets this plan
section, a Sonnet build, the review protocol, the quality gate, browser QA on
real links, and a side-by-side check against the prototype. Each slice opens a
pull request based on the previous slice's branch. Merging stays with the
owner.

## Slice 2: Outline + Pencil

### Scope

- **Outline dial**: a tick rail at the left edge of the reader pane.
- **Reading pencil**: a line guide that sweeps the current line at a set pace.
- **Resume point**: where the reader stopped, saved on the server, shown as a
  play button, and readable and writable over the API and MCP.
- The dock gains a **Pencil** split button: the main part toggles the pencil,
  and a chevron opens the Pencil sheet.

### Out of scope

Highlights and their tints on the dial (slice 3), read aloud (slice 4), and AI
section summaries for the outline cards. Parked: an AI summary in the outline
card goes to `future-scope.md` under AI features.

### Data: reading position

- **New table `reading_positions`** (migration 0027, hand-named
  `0027_reading_positions`): `link_id uuid primary key references links(id)
  on delete cascade`, `position real not null` (0 to 1, a share of the
  article's words), `updated_at timestamptz not null default now()`. A
  separate table keeps frequent position writes from bumping
  `links.updated_at`. The cascade purges it with the link. It survives trash
  and restore because the link row survives.
- **Core** (`packages/core/src/links/reading-position.ts`):
  `getReadingPosition(linkId)`, `setReadingPosition(linkId, position)` (an upsert that
  rejects values outside 0..1 and non-finite values with the existing
  validation error type), and `clearReadingPosition(linkId)`. Writes
  call `assertLibraryWrite` like `editLink`; a trashed or unknown link returns
  null (not found).
- **Restore merge** (`links.ts` restore path that folds notes and tags): keep
  the newer of the two positions.
- **Link JSON** (`api/src/link-json.ts`) and the MCP `baseLinkShape`: add
  `readingPosition: { position: number, updatedAt: string } | null`,
  explicitly, with the leak-guard tests both rules require. Fetch it with the
  link in one query (a left join), not one query per row. List endpoints do
  not need it; include it only where the single-link shape is built, and keep
  list queries unchanged.
- **API**: `PUT /api/links/:id/reading-position` with body
  `{ position: number }` (Zod, 0..1, finite) returns `{ readingPosition }`;
  `DELETE` clears it and returns 204. Not found returns the standard 404
  envelope. Real-Postgres route tests.
- **MCP** (parity rule): extend `edit_link` with an optional
  `readingPosition: number | null` (null clears). `get_link` returns the field
  through `baseLinkShape`. Update `parity.test.ts` and the tool description
  so an agent knows what the number means.
- **Export and import**: add an optional `readingPosition` to `ExportedLink`
  and the import schema (no version bump; old files import unchanged). CSV
  export leaves it out.

### Web

- **Pencil engine** (`components/reader/pencil/`): compute line boxes from the
  prose text with `Range.getClientRects()`, skipping code blocks, figures,
  captions and tables. Recompute on resize, type changes (slice 1 prefs) and
  fonts loading. One `requestAnimationFrame` loop while playing; nothing runs
  while paused.
- **Styles**: Underline (a 2px pencil line under the current line) and
  Highlighter (a soft translucent band behind the line), as in the prototype.
  The style and the pace (100 to 600 wpm, step 20, default 240) are
  browser-local prefs through `createPrefStore`.
- **Controls**: the dock's Pencil split button (main: toggle; chevron: sheet).
  The sheet holds play/pause, the wpm `Stepper`, a progress bar with percent,
  and the Underline | Highlighter `Segmented`. No helper text; shortcuts in
  `title` tooltips.
- **Keys** (ignored in inputs, textareas, contenteditable and open dialogs):
  `p` toggles the pencil, Space plays or pauses while it is on, ArrowUp and
  ArrowDown move a line, `+` and `-` change speed, Escape turns it off after
  any open sheet closes. While the pencil is on it takes over the Reader's
  `j`/`k`/arrow link stepping, as in the prototype; when it is off, the
  Reader's keys work as today.
- **Click a line** to move the pencil there while it is on.
- **Auto-scroll** keeps the current line in the middle third of the pane;
  respect `prefers-reduced-motion` (jump instead of smooth scroll).
- **Resume**: save the position (share of words) when the pencil pauses, stops,
  every 10 seconds while playing, and on `pagehide` (fetch with
  `keepalive`). On open, if a saved position exists, show a 24px accent play
  button in the right gutter column, centred on that line (the same column the
  slice 3 note markers will use). Clicking it turns the pencil on and plays
  from there. Optimistic cache update for the link query; no full refetch per
  save.
- **Outline dial** (`components/reader/outline/OutlineRail.tsx`): ticks for
  paragraph groups (at most 40, merged evenly), 4px gap, uniform at rest,
  headings brighter, the current group in ink. Dock-style magnification on
  hover with spring physics from `motion` (MIT; `motion/react`): crest 36px,
  falloff over about five ticks, stiffness 300, damping 25, mass 0.5. A card
  follows the crest with the group's title (heading or first sentence) and two
  muted lines, clamped inside the pane. Click scrolls to the group. Hidden when
  the pane is narrower than 700px. Reduced motion: no springs, static crest.
  The rail is a `nav` with an accessible name; each tick is a button labelled
  with its title.

### Package choices

- `motion`: the spring engine the owner approved during prototyping (the
  ready-made "Chapter Scrubber" needs a 21st.dev key). Imported only by the
  outline rail, so the main bundle grows only where the rail renders; lazy-load
  the rail if the build shows a large chunk.
- No package for line measurement: the platform `Range` API is enough.

### Tests

- Core and API: set, overwrite, clear, out-of-range, NaN, unknown id, trashed
  id, cascade on purge, restore keeps the newer position, link JSON includes
  the field, leak guard, MCP `edit_link` and `get_link` round trip, export and
  import round trip and old-file import.
- Web: line-box computation on a fixture, wpm timing (fake timers), keys and
  their guards, the reader's own keys when the pencil is off, resume button
  placement and click, save throttling and `pagehide`, prefs validation, rail
  grouping cap and click-to-scroll, reduced-motion path.

### QA and mockup parity

Real links in `silo_reader_qa` at 1440, 1100 and 390 px, light, dark and
sepia: pencil sweep in both styles, keys, click-to-jump, auto-scroll, resume
after reload and after closing the tab, dial hover and click on a long article,
and the MCP `get_link` output. Then compare side by side with prototype
variant B (`prototype/reader-tools`, Vite on another port against the same
API) and fix every unintended difference.
