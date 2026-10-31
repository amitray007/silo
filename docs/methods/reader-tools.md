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
  any open sheet closes. While the pencil is on it takes over the arrow keys
  only, as in the prototype: `j` and `k` still step links. When it is off, the
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

## Slice 3: Highlights and passage notes

Slice 3 ships as two stacked pull requests: **3a** (data, API, MCP, the
selection toolbar, rendering, and the note popover) and **3b** (the notes lane,
gutter markers, overlapping layers, and the lane's layout).

### Decision record

`docs/product/future-scope.md` recorded "separate highlight fields: decided
against". The owner reversed this on 2026-10-31: passage highlights with notes
ship as their own table. The link-level `notes` field stays unchanged. Update
that entry in 3a to point here.

### Data (3a)

- **Table `highlights`** (migration `0028_highlights`): `id uuid pk default
  random`, `link_id uuid not null references links(id) on delete cascade`
  (indexed), `quote text not null` (1 to 5,000 chars), `prefix text not null
  default ''` and `suffix text not null default ''` (up to 64 chars each),
  `start_offset integer` and `end_offset integer` (nullable hints),
  `color text not null` (check: yellow, green, blue, pink, violet),
  `note text` (nullable, up to 10,000 chars), `created_at`, `updated_at`.
- **Anchoring model** (W3C Web Annotation style): the quote with its prefix
  and suffix is the truth, and the offsets are hints into the prose's
  normalised text (whitespace collapsed, skipped blocks excluded, the same
  normaliser as the pencil's text walk). Overlaps are allowed: rows are
  independent ranges.
- **Core** (`packages/core/src/links/highlights.ts`): `listHighlights(linkId)`,
  `addHighlight(linkId, input)`, `editHighlight(id, { color?, note? })`,
  `deleteHighlight(id)`. Writes call `assertLibraryWrite`; feed posts are not
  editable (the existing error). For agent writes that pass only a quote,
  `addHighlight` finds the quote in the link's `extracted_text` (the
  `occurrence` input picks the nth match, default 1), fills prefix and suffix
  from there, and leaves offsets null; a quote that is not found is a
  validation error with a clear message.
- **Restore merge**: move the merged-away row's highlights to the surviving
  link.
- **Link JSON and MCP shape**: single-link reads add
  `highlights: Array<{ id, quote, prefix, suffix, startOffset, endOffset,
  color, note, createdAt, updatedAt }>` ordered by start offset then created
  time, loaded in one query per link read (no N+1), leak guards on both
  shapes. List endpoints stay unchanged.
- **API**: `POST /api/links/:id/highlights`, `PATCH /api/highlights/:id`,
  `DELETE /api/highlights/:id`, all Zod-validated, standard error envelope.
- **MCP** (parity): `add_highlight` (`id`, `quote`, optional `occurrence`,
  `color`, `note`), `edit_highlight`, `delete_highlight`; `get_link` returns
  highlights, and its text form lists each quote with its note. Tool
  descriptions explain overlap and the quote-matching rule.
- **Export and import**: an optional `highlights` array per link (no version
  bump; old files import unchanged). CSV leaves it out.
- **Search**: highlight notes are not searchable yet. Park "search passage
  notes" in `future-scope.md`.

### Web (3a)

- **Anchoring** (`components/reader/highlights/anchor.ts`): build the prose's
  normalised text and a text-node offset map once per render; resolve each
  highlight by offsets when the quote matches there, else by exact
  prefix+quote+suffix search, else by fuzzy match with `approx-string-match`
  (MIT, Hypothesis' matcher, maintained), else mark it orphaned. Orphans are
  kept and listed (3b shows them in the lane as "Passage not found").
- **Rendering** with the CSS Custom Highlight API: one registered highlight per
  colour plus overlap pieces (split at every range boundary; pieces covered by
  two or more ranges take the innermost range's colour at higher chroma). No
  DOM wrapping. Recompute on highlight change, type prefs change, and reader
  refresh.
- **Palette** (`styles/highlight-palette.css`): five semantic colours, per-theme
  oklch tokens for light, dark, sepia and sepia-dark from the prototype's
  `highlightPalette.prototype.ts` table (text on tint at least 4.5:1, minimum
  pairwise OKLab distance about 0.08).
- **Overlap colours**: a new highlight overlapping existing ones takes the next
  palette colour not used by the ranges it overlaps; the colour picker disables
  colours used by overlapping ranges unless all five are taken.
- **Selection toolbar** (`components/reader/highlights/SelectionBar.tsx`): a
  floating pill with a notch above the selection; Highlight (current colour
  dot; click applies; hover, focus or ArrowUp opens a separate colour picker
  with a hover bridge), Note, and a More menu (icon, 500 title, one muted
  line) with Copy quote (`"text" - Title, ¶n`, no link), Copy text, and
  Search silo (opens the command palette through its API with the phrase).
  Actions come from a typed registry so slice 4's "Listen from here" and
  future actions slot in. Keyboard reachable; Escape dismisses.
- **Note popover**: click a highlight to open a 280px popover below it with a
  borderless auto-growing note field, the colour dots, and delete. Saves on
  blur or close (optimistic, rolled back on error).
- **Hit testing**: a click or hover counts only inside a highlight's line boxes
  (`getClientRects`, 2px and 1px tolerance), never in the empty space beside a
  line.
- **Dock**: a Highlight tool (sheet: default colour; while open, a selection
  highlights at once) and a Notes tool (disabled with "No highlights yet" when
  there are none; 3a opens a simple list sheet, 3b replaces it with the lane).

### Web (3b)

- **Layers**: a click on text covered by two or more highlights opens the
  layers popover (innermost first; row: colour bar, snippet, note; hover
  isolates that range; Enter opens its note popover with a back button);
  Option-click cycles layers.
- **Gutter markers**: silo's note glyph, 16px muted, a 10px count when a
  paragraph has more than one highlight, hover circle on `--line` in dark;
  one per paragraph in the shared right gutter column, the same x as the
  slice 2 resume button (the resume button wins a shared line; the marker
  moves down a line).
- **Notes lane**: every highlight as a block (colour rule, note text, or a
  muted two-line snippet with "Add note" for bare ones; edit and delete on
  hover), grouped by paragraph, each group anchored at its paragraph and
  capped at max(paragraph height, 112px) with internal scroll, fade masks, and
  a "+N" chip; groups never overlap (measured heights, re-laid out on every
  change). Hover links a block and its range with a hairline.
- **Lane layout**: opening the lane shifts the column left on a spring just
  enough for a 264px lane; if the pane is too narrow it collapses the app
  sidebar through `AppFrame`'s own state (exposed via context, not synthetic
  key events) and restores it on close only if it collapsed it; below that,
  the lane is an overlay panel. Reduced motion swaps instantly.

### Tests

Core and API with real Postgres (CRUD, validation bounds, quote matching and
`occurrence`, not found, feed post, trash, cascade, restore move, export and
import, leak guards, MCP round trip and parity). Web: anchoring (exact, moved,
fuzzy, orphan, overlapping), overlap colour assignment, toolbar actions and
keyboard, hit testing, popover save and rollback, lane grouping and the
no-overlap layout (3b), marker counts, sidebar collapse restore (3b).

### QA and mockup parity

Real links at 1440, 1100 and 390 in light, dark and sepia; create, overlap,
recolour, note, delete; reader refresh keeps highlights; agent round trip
through MCP; then side by side with prototype variant B and fix every
unintended difference.

## Slice 4: Read aloud

### Scope

The dock's **Listen** tool reads the article aloud with an on-device voice
model. It covers smart segmentation, a gapless lookahead queue, sentence
highlighting, click-to-jump, a "Listen from here" toolbar action, engine and
voice choice, speed, and model files served by silo.

### Position in the product

Read aloud runs a speech model in the browser. It uses no provider, no key and
no server AI, and no article text leaves the device, so it sits outside the
AI layer in `docs/rules/ai.md` (add one line there saying so). Nothing
downloads until the reader presses Listen.

### Engines

Read aloud is **English-only for now** (owner decision, 2026-11-01). `kokoro-js@1.2.1`
ships only `en-us` and `en-gb` voices and an English phonemizer, and Phonon 31m is
English, so no engine here can read another language well. Multilingual read aloud is
parked in `docs/product/future-scope.md`.

- **Phonon 31m** (`phonon-tts`, code MIT or Apache-2.0, weights Apache-2.0,
  English): the default engine. Its package runs its own worker and streams audio as it
  generates. Its voices are the 25 `en-us` and `en-gb` voices of the
  `gradium/phonon-voices` catalog (Apache-2.0 on its card), registered through the
  `ModelSpec` `voices` map. The 12 character voices and the fr, de, es and pt voices are
  not shipped.
- **Kokoro 82M** (`kokoro-js`, Apache-2.0): the second English engine, selectable in
  the sheet. It runs in a module Web Worker owned by silo, with the 28 voices
  `kokoro-js` lists. WebGPU uses fp32 (the prototype measured fp16 as degraded); without a
  real WebGPU adapter it uses q8 on WASM, and the sheet says it may be slower. A WebGPU
  start that fails is retried on a fresh worker, because ONNX Runtime keeps the failure.
- **Phonon 40m is excluded**: its weights are CC BY-NC 4.0.
- The engine, one voice per engine, and the speed are browser-local
  (`createPrefStore`, key `silo.readerReadAloud`).
- **Language gate.** The stored reader and the link carry no language field, so the
  article language comes from its text (`listen/language.ts`: a non-Latin script, or
  Latin text with almost none of the common English words, is not English; text too
  short to judge counts as English). For a non-English article the dock's Listen button
  is disabled with the title "Read aloud is English-only for now", and "Listen from
  here" is left out of the selection toolbar.

### Model files served by silo

- A manifest in code (`packages/core/src/tts/manifest.ts`) lists each engine's files:
  source URL pinned to a commit, size, sha256, and the license. It ships 62 files:
  Phonon (config, tokenizer, q8 weights, a default voice, 25 voices) and Kokoro
  (config, tokenizers, the q8 and fp32 ONNX models, 28 voices).
- `GET /api/tts/files/:engine/*path` serves only manifest entries. On the
  first request the server downloads the file from its pinned URL into the
  data directory (`$SILO_DATA_DIR/tts-cache/`, stored by sha256), verifies the sha256, and
  then serves it with immutable cache headers and range support.
  `SILO_DATA_DIR` defaults to `$XDG_STATE_HOME/silo` (or `~/.local/state/silo`); the
  prod compose mounts a volume at `/data`. `GET /api/tts/manifest` lists the files
  (without upstream URLs) for the web, which keeps the last good answer so a cached
  voice loads while silo is unreachable. Concurrent first requests share
  one download. A failed or mismatched download returns 502 and leaves no
  partial file.
- The web points `phonon-tts` (`ModelSpec`) and transformers.js
  (`env.remoteHost` / `remotePathTemplate`) at these URLs, so the browser never calls
  Hugging Face. Two things `env` does not cover are handled in the Kokoro worker:
  `kokoro-js` fetches each voice from a hard-coded Hugging Face address (a `fetch`
  wrapper sends it to silo and refuses any other Hugging Face request), and ONNX
  Runtime fetches its WebAssembly files from a CDN (`wasmPaths` points at the copies
  in the transformers.js package, which Vite serves).
- Request `navigator.storage.persist()` when a model first loads.

### Speech plan

- Build segments from the prose DOM: sentences via `Intl.Segmenter`, headings
  followed by a 250 ms pause, paragraph ends by 150 ms, list items spoken as
  sentences with no bullet words, and code blocks, figures and captions
  skipped.
- Merge adjacent short sentences (under 60 characters, same paragraph) up to
  200 characters; split sentences over 300 characters at clause boundaries.
  Keep a sentence map so highlighting stays per sentence.
- Keep about 20 seconds (at least 3 units) synthesized ahead; the clicked unit
  goes first; cancel stale work on jump, voice, engine or speed change.
- Schedule buffers on the `AudioContext` timeline (`start(when)`) for gapless
  playback. Phonon streams its chunks as they arrive.
- Speed 0.75 to 3x. Kokoro uses its native speed. Phonon at 1x streams; at
  other speeds use a pitch-preserving time stretch (WSOLA, as the prototype
  did) on the whole unit.
- An in-memory replay cache keyed by engine, voice, speed and text, capped at
  about 64 MB (least recently used goes first).
- Warm up when the Listen sheet opens: load the model and synthesize the first
  units.

### UI

- **Listen tool**: pressing it turns the dock into the player and opens the Listen sheet,
  ready to play (as the prototype did; the sheet warms the voice and the audio device opens
  on that press, so Play starts in a few milliseconds). The player has previous, play/pause
  with a loading-dev spinner while waiting, next, the current sentence text, speed, a list
  button for the sheet, and close. "Listen from here" and a click on a sentence start
  playing at once.
- **Listen sheet**: engine and voice in silo's custom listbox (voices grouped
  by language, name at 500, muted trait, type-ahead, never truncated), the
  speed `Stepper`, and the download state ("Downloading voice · 42%" with MB
  and a slim bar); skeleton rows while voices load. No helper text.
- **Sentence highlight**: a dedicated Custom Highlight with its own token, under
  passage highlights in priority.
- **Click to jump**: while Listen is open, a click on any sentence starts there.
  This takes priority over the note popover. Keys: Space play or pause,
  ArrowLeft and ArrowRight previous or next sentence, `+` and `-` speed.
- **Selection toolbar**: add "Listen from here" to the action registry.
- **Errors**: a model that fails to load shows Retry and an engine switch;
  playback never blocks reading.

### Tests

Manifest allowlist, path traversal, sha256 mismatch, shared first download,
range requests, and cache headers on the server; segmentation (headings,
lists, code, abbreviations, long sentences, merge rules), the queue
(lookahead, cancel on jump, priority, cap), scheduling maths, WSOLA length,
replay cache eviction, the language-to-engine default, keys and click
priority, and the sheet states on the web. Engines are mocked in unit tests.

### QA and mockup parity

In a real browser on real links: cold and warm load for both engines, time to
first audio, gaps, click-to-jump, speed changes, voice changes, an article in
another language (Listen disabled, no "Listen from here"), offline after caching, and no
request to a third-party host. Then
compare the dock player and Listen sheet side by side with prototype variant B
and fix every unintended difference.
