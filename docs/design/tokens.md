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
**Type:** Geist Sans only (400/500/600 — 500 dominant). No mono, no pixel, no display face. Hierarchy by two-tone color.

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
- **Row:** favicon + title (ink 500) + domain suffix (ghost 400) — nothing else at rest. Hover reveals `domain · time`, edit, trash. Marks whisper: ¶ note (amber) · ◆ claude (ghost) · ◌ incomplete (amber, reason+retry in hover meta). Notes reveal under the row, italic muted.
- **Omnibar:** one soft field on bg-2 — paste = keep, type = find, ⌘K.
- **Filters:** tag pills (soft, counts as ghosts); segmented pill reserved for true either/or (library/trash, light/dark). Active state = ink on raised bg, never amber.
- **Day labels:** Today / Yesterday / This week / Earlier — small warm 500.
- **Settings:** tabbed modal (plugins / preferences / import+export / access); rows = name + description + right control; enabled = small amber dot. Import/export and trash config live here (footer card retired).
- **Both themes ship**; theme is a user setting. Interactive card toggles live.
- **Sidebar (layout variant):** shiori's rail translated to silo — brand dot, **Library / Trash** (their Inbox/Archive; silo has no queue), tags with ghost counts, `+ new tag`, Settings at bottom. Text-only, no icons (anti-slop). Trash row always shows its purge countdown. Sidebar sits on bg-2; active item = ink on raised bg. Two layouts now exist — **centered** (`screens/library-interactive`) vs **sidebar** (`screens/library-sidebar`) — default undecided.

## Anti-slop rules
- Nothing bold. Nothing pure-gray. Amber never fills a control. No icons beyond the four marks + favicons. Healthy rows carry zero status chrome ("silence means complete" survives from round 2).

## App design — COMPLETE (2026-07-03)
Full core-store UI designed, reviewed, fixed, and **captured to `app/`** (`Silo-v2.html` + fonts + runtime + reference PNGs + README). Every screen done: library (both themes), empty state, trash, settings (4 tabs), edit modal, omnibar states, HN/tweet rich cards, live enrich/import/retry. UI review punch-list (`ui-notes.md`) applied and verified. This is the reference the build agent implements against; stack still undecided.
