# Silo - Design tokens

## Redesign 2026-10

The approved three-pane prototype replaces Oat's warm palette and Stack mark
with crisp neutral surfaces and an orange tile mark. This gives the list and
reader separate surfaces while keeping primary actions in ink. The source is
`docs/design/prototypes/silo-redesign.src.html`; its token blocks and brand
styles take precedence over the historical design notes below.

- Geist Sans 400/500/600 is self-hosted. Use 600 for the brand, pane titles,
  reader headings, and controls where the prototype uses it. The 600 latin
  woff2 is extracted from the built prototype and stored beside `fonts.css`.
- Light: ground `#f6f6f5`, panel `#ffffff`, line `#e6e6e4`, stronger line
  `#d6d6d3`, hover `#f1f1ef`, selection `#ebebe9`, ink `#0c0c0b`, muted
  `#5c5c59`, faint `#8a8a86`, button `#111110` on `#ffffff`.
- Dark: ground `#0a0a0a`, panel `#111111`, line `#222222`, stronger line
  `#2e2e2e`, hover `#181818`, selection `#1f1f1f`, ink `#f3f3f2`, muted
  `#a3a3a0`, faint `#757572`, button `#f3f3f2` on `#0a0a0a`.
- Brand gradient: `#ffb23f` to `#ff6a13` at 160 degrees. The 26px tile has a
  7px radius and three white bars at 1/0.72/0.46 opacity. It replaces the
  Stack mark in the app, favicon, PWA icons, and staged macOS icon.
- Accent `#f26b1d`; accent text light/dark `#b8480a`/`#ff9a52`; accent soft
  light/dark `#fff1e6`/`#2a1709`; danger `#d63a2f`. Accent is allowed for the
  mark, the prototype's Add link focus accents, and toast action text.
  Primary buttons stay ink. Focus rings elsewhere stay neutral.
- Keep existing token names where roles match: `--bg2` maps to prototype
  `--panel`, `--mark` to `--accent`, `--markt` to `--accent-ink`, `--warn` to
  `--danger`, and `--ease-out` to `--ease`. `--ghost` uses the faint tone for
  non-text affordances. Settings surface aliases use the neutral ramp.
- Elevation follows shiori.sh's shipped CSS (studied 2026-10-25): a 0.5px
  `--ring` replaces the border on raised surfaces, which set their border
  transparent, then two or three soft stacked drops. `--elev-1` is the control
  shadow, `--elev-2` the menu shadow, and `--elev-3` the dialog shadow. Scrims
  are light in light mode (`#f1f1ef` at 80%) and near-black in dark mode, both
  with `--scrim-blur` (4px).
- Reader prose follows shiori's prose rules: body in `--mut`, headings, links,
  code, and bold in ink, list markers and captions in `--fnt`, bold at 500,
  headings 26/21/18/16px, tables with row rules only.
- Existing type and
  spacing scales remain for components until their redesign unit. Removed
  tokens: the old mark plate, badge colors, and unused motion/spacing roles.
- Keep the pre-paint theme script and both themes. Healthy rows have no
  completion badge. Favicons use the local proxy; a missing favicon falls back
  to a neutral globe icon. Images use the preview proxy.

The sections below record earlier decisions. They do not override this redesign.

**Canonical home:** Claude Design project **"Silo"** (`3a2c2144-2546-4c3b-93a9-e9e172848e09`) — 11 cards: Foundations (brand, colors, type), Components (omnibar, rows, filters, marks, settings), Screens (library light / dark / interactive).
**Direction:** v2 "Oat" — chosen 2026-07-03 after the Geist Pixel/Mono system was rejected. Grounded in a live analysis of shiori.sh (gstack browse, computed CSS): **learn its structure and layout; own the brand.**

## The shiori lessons (from its real tokens, not vibes)
1. One typeface at **medium weight** — headlines are weight 500 with tight tracking, never bold.
2. **Hierarchy by color, not size/weight** — headline ink + same-size muted subtitle (their "oatmeal-500" two-tone).
3. **Warmth lives in the neutrals** — every gray carries a warm hue (their oklch hue 44–75 "oatmeal" ramp). No cold grays anywhere.
4. **The accent is a mark, not chrome** — their orange sun brands and dots; buttons stay ink/neutral.
5. Soft radii, pill segmented controls, thin icons; settings = tabbed modal of name/description/control rows.

## Silo's tokens
**Type:** Geist Sans only (400/500 — 500 dominant). No mono, no pixel, no display face. Hierarchy by two-tone color. *(Build note: only 400/500 are actually loaded — see "Build reconciliation" below; the earlier "600" was aspirational and never shipped, consistent with "nothing bold.")*

**Color — one warm ramp, two themes:**
| token | light | dark | use |
|---|---|---|---|
| bg | `#FBF7EF` | `#171310` | ground |
| bg-2 | `#F4EDE1` | `#201A15` | inputs, pills |
| line | `#EBE2D2` | `#2C251D` | borders |
| hover | `#F3ECDF` | `#211B15` | row hover |
| ink | `#211B11` | `#EDE5D8` | titles, primary text |
| muted | `#6E6350` | `#A89A87` | secondary text |
| faint | `#8C8170` | `#8C7F6C` | hints, meta |
| ghost | `#B3A78F` | `#6E6353` | suffixes, counts |
| **mark** | `#C98F2D` | `#D9A441` | **the grain — dot + status marks ONLY** |

**Brand:** the "Stack" mark — three rounded bars (32-grid), the lower two `--ink` at 0.34/0.62 opacity (theme-aware), the top bar the fixed amber grain gradient (linear `#E8B054→#C98F2D`) — + lowercase `silo` wordmark, weight 500, tight tracking. The mark never becomes a button fill or UI chrome; it is only the favicon/in-app mark/toolbar icon. The Mac/PWA app icon (dark ground, vivid grain `#FFD98A→#F0A93E→#C9791C`) is the one sanctioned saturated-amber surface, since it's product identity rather than in-app chrome.

## Components (as designed)
- **Row:** favicon + title (ink 500) + domain suffix (ghost 400) — nothing else at rest. Hover reveals `domain · time`, edit, trash. The settled-state title badges (¶ note · ◆ claude) were **removed** in a later polish pass — a `full`/`partial`/`bare` row carries no status glyph. The one surviving mark is the transient `◌ capturing` pulse, shown next to the domain **only while a row is `enriching`** and gone the instant it settles ("silence means complete" carves out room for an in-progress indicator, not a resting badge). Notes still reveal under the row as an italic muted line when set.
- **Omnibar:** one soft field on bg-2 — paste = keep, type = find, ⌘K.
- **Filters:** tag pills (soft, counts as ghosts); segmented pill reserved for true either/or (library/trash, light/dark). Active state = ink on raised bg, never amber.
- **Day labels:** Today / Yesterday / This week / Earlier — small warm 500.
- **Settings:** tabbed modal (plugins / preferences / import+export / access); rows = name + description + right control; enabled = small amber dot. Import/export and trash config live here (footer card retired).
- **Both themes ship**; theme is a user setting. Interactive card toggles live.
- **Sidebar (layout variant):** shiori's rail translated to silo — brand dot, **Library / Trash** (their Inbox/Archive; silo has no queue), tags with ghost counts, `+ new tag`, Settings at bottom. ~~Text-only, no icons (anti-slop).~~ *(Superseded — v3/plan 011 adopted a thin-stroke icon+label nav; see "Build reconciliation.")* Trash row always shows its purge countdown. Sidebar sits on bg-2; active item = ink on raised bg. Two layouts now exist — **centered** (`screens/library-interactive`) vs **sidebar** (`screens/library-sidebar`) — default undecided.

## Anti-slop rules
- Nothing bold. Nothing pure-gray. Amber never fills a control. Healthy rows carry zero status chrome ("silence means complete" survives from round 2).
- **Icons:** the four marks (¶ ◆ ◌) + the grain dot + favicons are always allowed. v3 (plan 011) additionally adopted a **restrained thin-stroke functional icon set** — nav icons (Library/Trash/Settings), row-menu actions (open/copy/edit/trash), dock actions, and the omnibar/tag-find magnifier — plus functional affordance glyphs (✕ close, ☰ drawer, ⌘K hint, ⋯ menu, ✓ select). These are affordances, not decoration; no purely decorative icon is permitted. *(This supersedes the earlier "no icons beyond the four marks" line — see "Build reconciliation.")*

## App design — COMPLETE (2026-07-03)
Full core-store UI designed, reviewed, fixed, and **captured to `app/`** (`Silo-v2.html` + fonts + runtime + reference PNGs + README). Every screen done: library (both themes), empty state, trash, settings (4 tabs), edit modal, omnibar states, HN/tweet rich cards, live enrich/import/retry. UI review punch-list (`ui-notes.md`) applied and verified. This is the reference the build agent implements against; stack still undecided.

## Build reconciliation (2026-07-06 — design-conformance audit pass)
The sections above are the original v2 design record. This section records where the **shipped web app** (`packages/web`) is the current source of truth, after a full audit-and-fix pass (motion, typography, composition, color, casing). The token values below live in `packages/web/src/styles/tokens.css`.

**Text-tone ramp (roles, real hex).** Four tones, applied by ROLE, not by size — this is the "hierarchy by color, not size" thesis made literal:
| token | light | dark | role |
|---|---|---|---|
| `--ink` | `#211b11` | `#f2e9db` | titles, primary text |
| `--mut` | `#6e6350` | `#ad9e89` | secondary text, descriptions |
| `--fnt` (faint) | `#736850` | `#94856f` | tertiary — meta, counts, day labels, domain suffix, placeholders |
| `--ghost` | `#857963` | `#85795f` | **NON-TEXT ONLY** — borders, focus rings, icon strokes, decorative glyphs |

`--ghost` was demoted to non-text because as body text it failed WCAG AA in light mode (4.00:1); `--fnt` carries all the secondary/meta *text* and clears AA in both themes. (The row's title vs domain differ by **color + weight at the same size** — `--text-base`, ink/500 vs fnt/400 — never by size.)

**Scales (in `tokens.css`).** A short type scale `--text-xs…xl` (0.72–1.15rem, 6 steps — collapsed from 22 ad-hoc sizes); a 4px spacing scale `--s-0-5…--s10`; tracking `--tracking-tight -0.01em` (headlines + wordmark) / `--tracking-label 0.04em`; line-height `--lh-tight/snug/body`; elevation `--elev-1/2/3` + `--scrim` (tuned per theme — dark uses a blacker shadow since a warm shadow is invisible on the near-black ground); and `--row-inset` (40px) — the favicon-column grid the day label, header title, row title, HN line, and note all align to. Numbers use `tabular-nums` app-wide.

**Casing.** UI text is **sentence case** everywhere (labels, actions, headings, descriptions, placeholders, tabs, menu items, empty/error lines). Exceptions: the `silo` wordmark stays lowercase; proper nouns keep real casing (Hacker News, GitHub, YouTube, MCP…); key hints (`esc`, `⌘K`) and mid-phrase units after a number (`5 points`, `3 selected`) stay lowercase; glyph marks are not text. *(This supersedes the v2/v3 lowercase-"chrome" convention.)*

**Motion.** Emil-Kowalski-conformant: custom easing curves (`--ease-out/in-out/drawer`), transform+opacity only, origin-aware popovers, `@starting-style` entrances, universal `:active` press feedback, hover states gated behind `@media (hover:hover) and (pointer:fine)`, and `prefers-reduced-motion` that removes movement while keeping gentle opacity/color fades. Keyboard-initiated actions (⌘K, Escape) never animate. Route content and the row's hover-revealed meta fade in rather than snap.

**Amber discipline holds:** `--mark`/`--markt` remain marks only (grain dot, ¶/◆/◌, the "keep" hint, active-tag dot) — never a button fill, border, active state, or focus ring. Focus rings use `--ghost`, never amber.

## Shiori match 2026-10-25

`docs/methods/shiori-match.md` supersedes the earlier visual values. The app uses self-hosted Inter Variable and Tailwind neutral oklch tones. All panes share `--bg`; menus and dialogs use `--bg2`. Dividers are 0.5px. Control, popup, and dialog shadows use `--elev-1`, `--elev-2`, and `--elev-3`.

Body and nav use weight 400. Row titles, pane titles, section labels, menus, and buttons use 500. Reader titles and headings use 600. Monospace text uses `--font-mono`. No font files or external font requests are needed.

`--ghost` is quaternary text: neutral 400 in light and neutral 600 in dark. Counts, day labels, and key hints intentionally use it to match Shiori. These labels fail WCAG AA contrast. This is an accepted reference trade-off, limited to those roles. Primary, secondary, and tertiary text retain separate tokens. The orange tile and local source chips preserve Silo's identity and privacy.


## Shiori match pass 2, 2026-10-26

Pass 2 in `docs/methods/shiori-match.md` overrides the earlier recipes. Inter Variable is self-hosted through `@fontsource-variable/inter` (OFL-1.1), at weights 400, 500, and 600. Reader body text is 16px with a 28px line height. Icons use a 20px box, a 24-unit viewBox, and a 1.5px rounded stroke.

Row hover uses `--row-hover`; controls use `--icon-hover`. The reader segment chip uses `--segment-on` and the full control shadow. Dark inputs use neutral 800 and the low contrast shadow. Focus outlines use tertiary text at 2px with a 2px offset. Settings remains silo's modal with its own tabs and Compact links preference.

## Home audit, 2026-10-29

`docs/methods/home-ui-audit.md` records the audit and its decisions.

Tertiary text (`--fnt`) departs from the shiori table on purpose. Shiori uses neutral 500 in both themes. That fails WCAG 1.4.3 for small text: 4.18:1 on the dark ground and 3.78:1 on the dark segment track. Silo uses oklch 53% in light and 60% in dark. Measured: light 5.15:1 on `--bg` and 4.84:1 on `--hov`; dark 5.01:1 on `--bg` and 4.54:1 on `--hov`. Both values still fail on the selected fill `--sel` (about 4.39:1 light and 3.39:1 dark), so text on `--sel` uses `--mut` instead of `--fnt`. The `--ghost` trade-off above is unchanged. In dark, the same applies on the lifted fills where `--fnt` measures 3.8-4.2:1: input placeholders, the model picker, and key hints on a highlighted menu item. The theme toggle's off label uses `--fnt`, not `--ghost`.

Danger text (`--warn`) is Tailwind red 700 in light and red 400 in dark, so labels such as "Move to trash" clear 4.5:1 on every fill they sit on (red 500 measured 3.3-4.0:1). Buttons with white text on red use `--danger-fill`: red 700 in light (6.42:1) and red 600 in dark (4.77:1).

The two icon-button radii are intended, not drift. The list `+` and the row action buttons use 8px. The reader toolbar buttons and the sidebar collapse button use 6px, as `shiori-match.md` lists them ("radius 6 or 8 as listed").
