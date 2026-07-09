# Plan 026 — Plugins settings redesign: logo grid + per-feature toggles

**What:** Redesign the Settings → Plugins tab into a **4-up logo grid** (real
brand logos in circular tiles, title below, status dot) that **expands inline**
to a control panel with a **master enable + independent per-feature toggles**
(inline vs on-hover). Expand the settings schema from one boolean per plugin to
`{ enabled, inline?, hover? }`, with migration + worker/render enforcement.

User-picked design (ASCII approved): grid → expand-inline accordion. Logos: real
colorful brand SVGs (via `@thesvg/cli`, already bundled locally), styled in
circular tiles.

## Locked decisions (do not re-litigate)
- **Layout:** 4-up grid of source cards (logo centered in a circular tile, title
  below, small status dot). Clicking a card expands a control panel BELOW the
  grid (accordion, single scroll — no navigation, no side panel).
- **Per-feature model:** each source has a **master `enabled`** plus the feature
  toggles it actually supports:
  - `hacker_news`: `{ enabled, inline, hover }` (HN renders BOTH inline + hover).
  - `github`: `{ enabled, hover }` (hover-only today).
  - `youtube`: `{ enabled, hover }` (hover-only today).
  - Turning off `enabled` disables the whole source (feature toggles greyed).
  - A feature toggle only shows for features that source supports.
- **Twitter/X** stays "Soon" (no toggle) — a fourth grid card with a Soon badge.
- **Logos:** real brand SVGs already bundled at
  `packages/web/src/assets/plugin-logos/{y-combinator,github,youtube,x}.tsx`
  (self-hosted, zero runtime network — honors the no-third-party-call rule).
  Styled in a **circular tile**: colorful logos (YC orange, YouTube red) on a
  subtle tile; dark logos (GitHub `#181717`, X black) get a **light/white
  circular backing** so they're visible on the dark UI. Per user: "real logo
  with circular white background or color flowing based on the logo."
- **Never changes what's saved.** Toggles gate NEW enrichment + rendering only;
  existing saved links' data is untouched (preserve the current guarantee + the
  tab's footer note).

## The 4 sync points (from exploration — keep all in lockstep)
The plugin identity is spread across four touchpoints that a module-load drift
guard already asserts match. All four move together here:
1. `packages/core/src/settings/schema.ts` — the `plugins` Zod schema + defaults.
2. `packages/web/src/api/types.ts` — the hand-mirrored `SettingsMap` (web can't
   import core).
3. `packages/worker/src/enrich.ts` + `enrich-source/index.ts` — toggle
   enforcement (currently reads `plugins[kind]` boolean → now `plugins[kind].enabled`).
4. `packages/web/src/components/SettingsTabs/PluginsTab.tsx` — the UI.

---

## Unit 1 — schema expansion + migration (core; FOUNDATION, solo first)
The interface everything else builds against. **Do this first, alone.**

- `packages/core/src/settings/schema.ts`: change `plugins` from
  `{ hacker_news: boolean; github: boolean; youtube: boolean }` to:
  ```ts
  plugins: z.object({
    hacker_news: z.object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean() }).strict(),
    github:      z.object({ enabled: z.boolean(), hover: z.boolean() }).strict(),
    youtube:     z.object({ enabled: z.boolean(), hover: z.boolean() }).strict(),
  }).strict()
  ```
  Defaults: every field `true` (all on, matching today's "enabled" default).
- **Migration (critical):** existing stored settings have `plugins:
  { hacker_news: true, ... }` (booleans). The settings value is a jsonb blob
  read through `parseSettingValue`. Add a **normalizer** that upgrades a legacy
  boolean to the new object BEFORE Zod validation: `true → { enabled:true,
  inline:true, hover:true }` (and the hover-only shapes for github/youtube),
  `false → { enabled:false, ... }`. Where: in the settings read path
  (`parseSettingValue` / `getSetting('plugins')` in
  `packages/core/src/settings/settings.ts`) so a legacy blob never fails
  validation. A stored object already in the new shape passes through untouched.
  - This is a READ-time coercion (no DB migration needed — settings is a single
    jsonb allowlist blob; the next `setSetting('plugins', ...)` writes the new
    shape). Confirm with the settings store's boundary-validation flow.
- Update `SETTINGS_DEFAULTS.plugins` to the new nested shape.
- **Tests (core):** the normalizer (legacy `true`/`false`/mixed → correct
  object; new-shape passthrough; unknown/garbage → default), schema validation
  accepts the new shape + rejects a stray key (`.strict()`), defaults are all-on.
- **Write an INTERFACES note** at the top of the plan's PR / commit body: the
  exact new `plugins` type string, so U2–U4 builders copy it verbatim.

## Unit 2 — worker enforcement (worker) — depends on U1
- `packages/worker/src/enrich.ts` reads `getSetting('plugins')` and threads it
  into `enrichSource`. Update the gate: a source's enrichment runs only when
  `plugins[kind].enabled` (was `plugins[kind]`). The per-feature `inline`/`hover`
  flags do NOT gate the worker fetch (we still fetch the data when enabled; the
  RENDER surfaces decide inline vs hover per U4) — UNLESS we decide fetching is
  wasteful when both render features are off. **Decision: gate the worker on
  `enabled` only** (simplest, and inline/hover are cheap render-time reads of
  already-fetched `sourceData`). Update the degraded-read default
  (`SETTINGS_DEFAULTS.plugins`) reference — already nested after U1.
- Update the module-load **drift guard** in `enrich-source/index.ts` if it
  compares against `plugins` keys (keys unchanged: `hacker_news/github/youtube`,
  so likely no change — verify).
- **Tests (worker):** enrichment skipped when `enabled:false`; runs when
  `enabled:true` regardless of inline/hover; degraded-read path uses new defaults.

## Unit 3 — web type mirror + toggle write (web api layer) — depends on U1
- `packages/web/src/api/types.ts`: mirror the new `plugins` shape into
  `SettingsMap` exactly (copy the interface string from U1). `UpdateSettingsRequest`
  stays `Partial<SettingsMap>`.
- The toggle WRITE currently replaces the whole `plugins` record
  (`setSetting('plugins', ...)` has no sub-key merge). The new UI writes a
  full updated `plugins` object each toggle — a small helper
  `setPluginField(pluginKey, field, value)` that spreads the current `plugins`
  and flips one nested field, then `updateSettings.mutate({ plugins: next })`.
  Master `enabled:false` should NOT wipe the feature flags (keep them so
  re-enabling restores prior inline/hover choices) — just flip `enabled`.
- **Tests:** the write helper produces the correct full nested object for each
  field flip; flipping `enabled` preserves `inline`/`hover`.

## Unit 4 — the redesigned Plugins UI (web) — depends on U1, U3
- **Logo tiles** (`packages/web/src/components/SettingsTabs/PluginLogo.tsx`,
  new): wrap each bundled SVG in a circular tile. Colorful logos (YC, YouTube)
  sit on a faint tile; dark logos (GitHub, X) get a light/white circular
  backing so they read on the dark UI. One `PluginLogo({ source, size })`.
  Import the 4 components from `assets/plugin-logos/`. Give each a consistent
  padded circle (~44px tile, ~24px logo). Respect reduced-motion.
- **The grid** (`PluginsTab.tsx` rewrite): a responsive 4-up grid of cards.
  Each card: circular logo tile (center), title below, a small status dot
  (amber `--mark` when `enabled`, ghost ring when off; "Soon" chip for X).
  Cards are buttons; clicking selects (keyboard-operable, `aria-expanded`,
  `aria-controls` → the panel). The selected card shows a caret/active ring.
- **The expand panel** (below the grid): for the selected source —
  - Header row: source name + master toggle (the existing amber-dot toggle,
    reused, now bound to `.enabled`).
  - A divider, then the **feature toggles** the source supports:
    - HN: "Inline on the row" (`inline`), "On hover (preview card)" (`hover`).
    - GitHub / YouTube: "On hover (preview card)" (`hover`) only.
  - Feature toggles are **disabled/greyed when master `enabled` is off**.
  - Keep the tab's footer note (plugins never change what's saved).
  - X selected → a "coming soon" panel (no toggles).
- Reuse existing toggle/badge styles from `rowStyles.ts` where possible; the
  amber-dot toggle button already exists — extract it into a small shared
  `PluginToggle` if it's now used in both the card dot and the panel rows.
- **Tests (web):** grid renders 4 cards with correct titles + status; clicking a
  card expands its panel; the panel shows the right feature toggles per source
  (HN has inline+hover, GH/YT hover-only, X none); toggling master greys the
  feature toggles; each toggle calls `updateSettings` with the correct nested
  write; X shows Soon and no toggles; the footer note renders.
- Update `PluginsTab` tests that asserted the old flat-list / single-boolean UI.

## Unit 5 — render surfaces honor per-feature flags (web) — depends on U1, U3
The payoff — inline vs hover actually respect the toggles.
- **Inline** (`LinkRow.tsx:296-316`): the HN inline points/comments line renders
  only when `plugins.hacker_news.enabled && plugins.hacker_news.inline`. Read
  `plugins` via `useSettings()` in `LinkRow` (or a small selector hook). Guard
  for the loading/undefined settings case (default to showing, matching today's
  `?? true` optimism, OR hide until known — pick showing-by-default to avoid a
  flash of missing data on load).
- **Hover** (`HoverPreview.tsx` dispatch, lines 399-407): the source-specific
  hover variant (HnVariant/RepoVariant/VideoVariant) renders only when that
  source's `.enabled && .hover`; otherwise fall through to `GenericVariant`
  (tags only) — the hover card still appears, just without the source detail.
- **Tests:** inline HN line hidden when `inline:false` (but data present); hover
  variant falls back to generic when `hover:false`; both show when on.

## QA / gate / review
- `DATABASE_URL=… pnpm turbo run check-types test build --concurrency=1` +
  `pnpm quality` exit 0 across all units.
- **Migration QA (critical, real infra):** seed a settings row with the LEGACY
  boolean `plugins` shape in a real Postgres, read it through `getSetting` →
  assert it coerces to the new object without error; write a new value → assert
  the new shape persists; confirm an already-migrated blob round-trips.
- Behavioral: toggle master off → new links from that source get no enrichment
  (worker) AND no inline/hover detail (render); toggle inline off (master on) →
  hover still works, inline line gone; toggle hover off → inline still shows,
  hover falls to generic. Existing saved links unaffected throughout.
- Visual: the grid + circular logo tiles in dark + light (dark logos legible on
  their light circular backing; colorful logos pop); the expand panel; greyed
  feature toggles when master off; X "Soon" card.
- Review: ce-frontend-design (grid + logo tiles match the Oat dark-craft look,
  logos legible both themes), ce-correctness (the migration normalizer edge
  cases + the nested write helper preserving flags), ce-data-integrity (the
  read-time coercion never corrupts a stored blob; forward/back compatibility),
  ce-api-contract (SettingsMap mirror matches core exactly). Resolve all.
- Commit per-unit on this slice branch; do NOT merge — user's eye gates the UI.

## Build order + parallelism
- **U1 solo first** (the schema + migration is the interface). Freeze it, write
  the exact new type string into the commit body as INTERFACES.
- Then **U2 (worker), U3 (web type+write), U4 (UI), U5 (render)** can fan out —
  U4 depends on U3's write helper, U5 on U3's type; U2 is independent of the web
  units. Suggested: U3 next (small, unblocks U4+U5), then U4/U5/U2 in parallel
  worktrees, integrate serially.
- Builder model: **Sonnet** per unit (feature code). Opus writes this plan +
  reviews + integrates.

## Sources
- Exploration findings (this session): schema `packages/core/src/settings/schema.ts:23-59`;
  web mirror `packages/web/src/api/types.ts:163-170`; worker gate
  `packages/worker/src/enrich.ts:69,192` + `enrich-source/index.ts:108-118,162-165`;
  UI `packages/web/src/components/SettingsTabs/PluginsTab.tsx:14-100`;
  inline render `LinkRow.tsx:296-316`; hover dispatch `HoverPreview.tsx:399-407`;
  settings store `packages/core/src/settings/settings.ts`.
- Bundled logos: `packages/web/src/assets/plugin-logos/{y-combinator,github,youtube,x}.tsx`.
