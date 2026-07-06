# Silo — Design system "Oat" (source of truth)

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

**Brand:** one amber "grain" dot (radial `#E8B054→#C98F2D`) + lowercase `silo` wordmark, weight 500, tight tracking. The dot never becomes a button fill or UI chrome.

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
