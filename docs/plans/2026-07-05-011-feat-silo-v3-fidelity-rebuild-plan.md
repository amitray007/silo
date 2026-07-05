# Plan 011 — feat: Silo v3 exact-fidelity UI rebuild

**Source of truth:** `docs/design/app/Silo-v3.html` (imported from the Claude Design
project "Silo", file `Silo v3.dc.html`, 2026-07-05). This SUPERSEDES the earlier
`Silo-v2.html` prototype and every prior UI assumption. Build the web UI to match
v3 **exactly** — alignment, spacing, tokens, and every feature. The user's
direction: "Follow this particular design completely exactly… I do not want things
missing or misaligning."

**Scope:** re-sync the whole `@silo/web` UI to v3. This is many slices — each a
faithful, gated increment — not one commit. This file is the master gap-map +
sequence; each slice gets built + reviewed + screenshot-verified against v3.

---

## What changed in v3 vs. what we built (the drift)

### Frame / shell — WE DIVERGED, v3 must win
- **v3 IS a floating card**, not full-bleed: the app is `max-width: 80rem`,
  `border: 1px solid var(--line)`, `border-radius: 16px`, `box-shadow: 0 26px
  70px -32px rgba(20,12,4,.55)`, centered on a **`--desk` desktop backdrop**
  (new token: `#E4DAC6` light / `#0B0906` dark). Outer padding
  `clamp(7px,2.1vh,20px) clamp(7px,2.1vw,20px)`, `height: 100vh` (not min-height).
  → We must REVERT the "full-bleed, no card" change (plan 009's `01e13b0`) and the
    right-wall change — v3 is a shadowed rounded card on a desk backdrop. The
    responsive/mobile-drawer work stays valuable but must be re-fitted to the card.
- **Sidebar width 216px** (we have 210), `padding: 15px 12px` (we have 16px 13px),
  `overflow-y: auto`, on `--bg2`.
- **Nav items have ICONS** (inline SVGs): Library (bookmark), Trash (trash can),
  Settings (sliders). We render text-only. v3 nav = icon + label + count.
- The content pane has a **header bar** (title + count + omnibar) with a
  `border-bottom`, then a scrolling body. We have no header bar.

### Tokens — DRIFTED, must re-sync exactly (tokens.css)
| token | v3 light | ours (wrong) | v3 dark | ours (wrong) |
|---|---|---|---|---|
| `--bg2` | `#F1E9DA` | `#F4EDE1` | `#141009` | `#201A15` |
| `--hov` | `#F1E9DA` | `#F3ECDF` | `#241D15` | `#211B15` |
| `--bg` (dark) | — | — | `#1A1510` | `#171310` |
| `--line` (dark) | — | — | `#2E2720` | `#2C251D` |
| `--desk` (NEW) | `#E4DAC6` | (absent) | `#0B0906` | (absent) |
Plus verify every other token against v3's `:root` / `[data-theme=dark]` blocks.
Add the `siloIn` + `siloFade` keyframes (v3 uses them for menus/modals/docks).

### The omnibar — MISSING ENTIRELY (v3's content header)
The content header holds a search/capture input, `width: clamp(230px,42%,430px)`,
on `--bg2`, radius 10, with a magnifier icon. Behaviors:
- **idle** → placeholder + `⌘ K` hint chip.
- **URL typed** → `keep ↵` affordance (markt "keep" + ↵ chip) → capture on Enter.
- **search text** → live results + `{found} · esc` chip; filters the list.
- **tag filter active** → a `#tag ✕` pill inside the bar (clear filter).
- Left of it: an **"◌ {done} of {total}"** enriching indicator when captures run.
- The header also shows the **view title + count** (Library / #tag / Trash).

### Rows — PARTIAL, needs the v3 chrome
We have the base row (chip, title, marks, note, domain). v3 ADDS:
- **Favicon over the letter chip** (`favBg` background-image on the 18px chip) —
  BUT our privacy rule forbids third-party favicon fetch. **DECISION NEEDED**
  (see Open decisions): keep letter-only (our privacy stance) or honor the design.
- **Hover meta** (`{time}` relative, right-aligned, hover-only).
- **The `⋯` menu button** (always present, ghost→ink on hover) → opens the row menu.
- **The `⋯` menu**: tags fly-out (find/toggle tags + create), open-in-new-tab,
  copy link, edit, move-to-trash. Full popover (`Silo-v3.html`, the `menuOpen` block).
- **Rich line** (`hasRich`): e.g. HN `▲ points · comments` — needs plugin data
  (parked until the plugin system, but the row SLOT + rendering must exist).
- **Multi-select**: hover checkbox → a bottom **selection dock** ("N selected ·
  move to trash · clear · esc").

### Hover-preview card — MISSING (the `pvOpen` fixed popover)
A rich hover preview positioned by cursor, with variants: **video** (thumbnail),
**repo** (stats + language bar), **tweet** (author + text), **HN** (points/
comments), **generic** (title + tags + note). Footer: domain · meta · open↗.
Needs plugin/source data → largely PARKED, but the generic variant works from
`LinkJson` today.

### Trash screen — MISSING (v3 has a full one)
Day-grouped trash rows with: chip, title, domain, a **`◷ {left}` purge-countdown**
(warn color), per-row **restore** + **delete-now** icon buttons. A bottom **trash
dock** ("{trashLine} · select all · empty all") and a **trash selection dock**
(restore/delete-now selected). Empty state "Trash is empty."

### Sidebar Tags — PARTIAL
v3 adds: a **`⌕` find-a-tag** toggle (reveals a filter input), **`+N more`**
truncation (show first 10, expand), **`+ new tag`** (inline input → create). We
render a flat list only.

### Settings modal — MISSING (v3 has a 4-tab modal)
Segmented-pill tabs: **Plugins** (HN/Twitter/YT/GH toggles + Set-up — PARKED,
plugin system), **Preferences** (Theme light/dark segmented + Trash auto-purge
cycle `{purgeLabel} ▾`), **Import/Export** (choose-file → preview → import N; export
JSON download), **Access** (MCP toggle, copy-config, access-token + rotate — MCP
UI is scope "Next"). Modal: `560px`, radius 14, scrim `rgba(24,17,7,.32)`,
focus-trap, esc.

### Edit modal — MISSING (the `editOpen` block)
`520px` modal: title input, description textarea, **tags picker** (chips + find/
create fly-out), **`¶` note** textarea (italic), footer trash / cancel / **✓ Save**.

### Selection docks / bottom bars — MISSING
Library selection dock, trash dock, trash-selection dock — all fixed-bottom pill
bars (`border-radius: 999px`, shadow, `siloIn`).

---

## Decisions (LOCKED at gate 1)

1. **Frame — KEEP our current full-bleed layout; do NOT revert to the v3 card.**
   User: "the current format is accurate, it just needs the other polishes." So the
   full-bleed centered band (plan 009) STAYS. We apply v3's *other* refinements
   (tokens, nav icons, spacing, the content header + omnibar, all the features) on
   top of the existing frame. We do NOT adopt v3's 80rem card / `--desk` backdrop /
   shadow. (`--desk` token not needed.) This is a deliberate, user-directed
   divergence from v3's shell — everything INSIDE the frame matches v3.
2. **Favicons — real favicons, self-proxied through silo.** User: "figure out how we
   can fetch this favicon for the websites." Honor v3's favicon-on-chip, but the
   BROWSER never fetches from third parties — silo proxies + caches favicons via a
   backend endpoint (e.g. `GET /api/favicon?domain=` → fetch server-side, cache,
   serve; letter-chip is the fallback while loading / on failure). Preserves the
   privacy rule (no third-party call from the row) AND the design. New backend work
   — its own sub-slice, gates the chip's favicon overlay.
3. **Plugin-dependent bits — build slots now, PARK the richness.** Generic hover
   preview + empty rich-line slot now; HN/tweet/repo/video richness + Plugins
   settings tab parked behind the plugin system (scope "Next").
4. **Mobile — keep responsive; exact v3 on desktop.** Desktop matches v3 precisely;
   the responsive drawer (plan 010) stays for narrow screens.

---

## Slice sequence (each: build → review → screenshot vs v3 → gate → commit)

**Foundation re-sync (do first, unblocks fidelity):**
- **V3-1 — tokens + sidebar + content-header shell.** Re-sync tokens.css to v3
  EXACTLY (all values, add `siloIn`/`siloFade` keyframes; NO `--desk` — we keep
  full-bleed). Update the sidebar to v3: 216px, `15px 12px` padding, nav ICONS
  (Library bookmark / Trash trash-can / Settings sliders inline SVGs) + label +
  count. Add the content **header bar** shell (view title + count + a right-aligned
  slot for the omnibar), `border-bottom`, then the scrolling body. KEEP the current
  full-bleed frame + responsive drawer. Screenshot vs v3 (inside-the-frame) both
  themes.
- **V3-2 — the omnibar (read side) + favicon proxy.** (a) Backend: `GET
  /api/favicon?domain=` — server-side fetch + cache + serve (letter-chip fallback);
  wire the chip's favicon overlay to it. (b) The omnibar input in the header:
  idle + `⌘K` chip; search text → live list filter + `{found}·esc`; tag-filter
  pill (`#tag ✕`); the `◌ N of M` enriching slot. Wires `/tags/:name` filtering +
  the search API.

**The write layer (the big unlock — establishes mutations):**
- **V3-3 — capture (omnibar keep).** URL-detect → `keep ↵` → `POST /links` +
  optimistic insert + the `◌ N of M` enriching indicator. First `useMutation`.
- **V3-4 — row ⋯ menu + edit modal + tag assignment.** The menu popover, the edit
  modal (title/desc/tags/note/trash/save via `PATCH` + tag add/remove), the tags
  fly-out + create-tag.
- **V3-5 — trash: screen + row actions + docks.** Trash view (grouped, purge
  countdown, restore/delete-now), the trash dock (select-all/empty-all), multi-
  select + selection docks (library + trash). All API-ready.
- **V3-6 — sidebar tags polish.** `⌕` find-a-tag, `+N more`, `+ new tag` inline.

**Settings + previews (some parked-dependent):**
- **V3-7 — settings modal.** Tabs shell + Preferences (theme + purge-cycle — purge
  needs a settings API) + Import/Export (needs import/export API) + Access (MCP —
  scope Next) + Plugins (PARKED). Build the shell + the ready pieces; stub the rest.
- **V3-8 — hover-preview card.** Generic variant from LinkJson now; video/repo/
  tweet/HN variants PARKED behind plugin data.

**Backend prerequisites** (surface as their UI slice needs them):
- configurable purge window (settings API), import/export routes, MCP-access
  settings/token — each blocks its Settings sub-panel.

---

## QA (every slice)
- **Screenshot vs `Silo-v3.html`** at desktop (≥1280) both themes; diff alignment,
  spacing, type-scale, tokens, the specific component. This is the acceptance bar:
  it must READ as v3, pixel-close.
- Real-stack round-trip against local Postgres for any data/mutation.
- Full gate 14/14 + build + `pnpm quality` + bundle pg-free, every slice.
- Review protocol per CLAUDE.md (local review + ce personas fitting the diff +
  design-implementation-reviewer against v3).

## Rules doc
Update `docs/rules/web-react.md`: v3 is the source of truth; the frame is the v3
card (revise the "full-bleed" layout rule I just added — it was based on a
misread); record the favicon/privacy decision.

---

## Sources
- `docs/design/app/Silo-v3.html` (the full design — every screen, component, the
  demo JS with the exact interaction logic + mock data shapes).
- `packages/web/src/**` (current build), `packages/api/src/routes/**` (what's
  API-ready — capture/edit/tags/trash/search all exist; import/export + purge-config
  + MCP-settings do NOT).
- The earlier UI audit (this session) for the built-vs-missing baseline.
