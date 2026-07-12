# Command-palette rich rows — hover popover + inline source-line (web UI)

**Date:** 2026-07-12
**Surface:** `packages/web` (the cmd-k command palette). Web UI only — no Raycast, no API/DB changes.
**Status:** design approved; ready for implementation plan.

## Problem

When the command palette returns many links from the same source/author (e.g. six
"Emil Kowalski (@emilkowalski) on X" rows), every row renders identically —
favicon + title + hostname — so the user can't tell them apart. Library rows already
solve this: they carry an inline source-line **and** a rich hover popover. The palette
rows do not.

## Goal

Bring the two things library rows already have into command-palette **link** rows:

1. **Hover popover** — reuse the existing `HoverPreview` card verbatim, for **every**
   link, exactly as the library does: source-specific variants for the four plugin
   sources (Twitter author/engagement/text, YouTube channel+thumbnail, HN points, GitHub
   stars/language) **and** the `GenericVariant` (og:image + tags) for any plain
   non-plugin link. This is the primary ask.
2. **Inline source-line** — a second line under the title so same-source rows are
   distinguishable at a glance. **HN + Twitter/X only** (mirrors library rows exactly) —
   these are the only sources with distinguishing inline text. YouTube/GitHub/generic
   links have no inline content, so they render **no** inline line (hover-only).

The **inline line and the plugin-source hover** are gated by a **new, independent
per-plugin `palette` flag** so the palette can be turned off per source without affecting
the library's own `inline`/`hover` surfaces. The **generic-link hover is not behind any
plugin flag** (there is no "generic" plugin) — it always shows, exactly as
`GenericVariant` does in the library.

## Non-goals

- No changes to Raycast or any other surface.
- No API, route, or DB-schema changes. `sourceData` already flows to palette results
  (`PaletteLinkResult = LinkJson | SearchResultJson | TrashLinkJson`), and settings is a
  jsonb allowlist — adding a key needs no migration table.
- Tag-suggestion rows (`PaletteTagRow`) are unchanged — only link rows gain this.
- No inline line for YouTube/GitHub/generic (no distinguishing inline content →
  hover-only, matching library).

## Design

### 1. Settings: new per-plugin `palette` flag

`packages/core/src/settings/schema.ts`:

- Add `palette: z.boolean()` to **all four** plugin objects (`hacker_news`, `github`,
  `youtube`, `twitter`) in `settingsSchema.plugins`. One flag per source gates **both**
  the palette hover card and the palette inline line for that source.
- Add `palette: true` to each source in `SETTINGS_DEFAULTS.plugins` (optimistic default,
  matching every other feature flag).

**Migration (technical decision — additive, made internally):**
`coerceLegacyPluginSource` currently matches stored objects on **exact field count**, so
naively adding `palette` to each `fields` list would make every already-stored blob
(which lacks `palette`) fail the arity check and **reset that source to all-defaults,
wiping the user's saved `enabled`/`inline`/`hover` choices.**

Fix: make the coercion **additive** — when a stored source object has all its keys as
booleans and its keys are a **subset** of the expected field list (i.e. it's a valid
older shape missing only newly-added fields), fill the missing fields from the source's
default rather than discarding the whole object. This:

- preserves a user's existing `enabled`/`inline`/`hover` choices while adding
  `palette: true`,
- keeps the existing "already-current shape passes through untouched" branch working
  (a full-arity object is trivially a subset of itself),
- still rejects genuinely malformed objects (a non-boolean value, or an *extra*/unknown
  key) by falling back to the default, preserving the module's "reject, don't strip"
  posture.

Update the `normalizePluginsValue` field-lists to include `palette` for all four sources.
Extend the schema unit tests: a stored `{enabled,inline,hover}` twitter blob (pre-palette)
must upgrade to `{enabled,inline,hover,palette:true}` with the first three preserved.

**Note — this generalizes an intentional exact-arity reset.** The current code
(schema.ts, twitter branch) deliberately treats a pre-inline `{enabled,hover}` twitter
blob as unrecognized and resets it to the twitter default, reasoning "there's no legacy
value to preserve for a flag that didn't exist yet." The additive rule reverses that: a
subset-shaped blob now keeps its known fields and only fills the *missing* ones. This is
the safer behavior (no silent loss of a user's `enabled`/`hover` choice when a new flag is
added), and it's the property we specifically need so adding `palette` doesn't wipe
existing choices — but it is a conscious change to that prior decision, not an oversight.
The exact-arity comment in `coerceLegacyPluginSource` must be updated to describe the new
subset semantics.

### 2. Hover popover wiring

**Blocker:** `<CommandPalette>` is mounted *outside* `<HoverPreviewProvider>` in
`AppFrame.tsx` — the provider wraps only `<main>`/`<Outlet/>`, while `<CommandPalette>` is
a sibling further down. So `PaletteLinkRow` can't call `useHoverPreview()` today.

**Fix:** move `<HoverPreviewProvider>` up one level in `AppFrame` so it wraps **both**
`<main>` (containing the library rows) **and** `<CommandPalette>`. The provider is
portal-based, so its DOM position is irrelevant — only that both consumers sit under it.
`RowMenuProvider`/`SelectionProvider` nesting is unchanged.

Then in `PaletteLinkRow`, mirror `LinkRow`'s hover triggers:

- `useHoverPreview()` → `scheduleShow(link, rect)` on mouse-enter (guarded by
  `isHoverCapable()`), `scheduleHide(link.id)` on leave, `dismiss(link.id)` on unmount.
- Anchor from the row's `getBoundingClientRect()`, same as `LinkRow`.
- The existing `HoverPreview` card + every per-source variant (including
  `GenericVariant`) render unchanged.

**Hover gating — gate at the TRIGGER, not inside the card.** The shared `HoverPreview`
card is used by both the library and the palette; internally it selects its variant by
`sourceData.kind` and gates the *plugin* variants on the library's `hover` flag
(`hoverEnabledFor`), **always falling back to `GenericVariant` rather than showing
nothing** — a plugin whose `hover` is off still shows a tags-only card, and a plain
`{kind:'link'}` link always shows `GenericVariant`. That means the palette's new `palette`
flag **cannot** be enforced inside the card (it would wrongly affect the library too, and
the card never "shows nothing" anyway). So the palette decides **whether to call
`scheduleShow` at all**:

- Plugin source (`hacker_news`/`github`/`youtube`/`twitter`): call `scheduleShow` only
  when `isPaletteSurfaceOn(settings?.plugins?.<kind>)` is true; otherwise skip it (no
  hover). `scheduleShow` already accepts an `options: { suppress?: boolean }` param —
  use that (or simply don't call it) to suppress per the flag.
- Generic/non-plugin link (`sourceData.kind === 'link'`): always call `scheduleShow` — it
  renders `GenericVariant`, exactly as the library does. Not behind any plugin flag.

The card itself is **not modified**; the palette only controls the trigger.

Palette rows live inside a `cmdk` list that can scroll/re-render as the user types; the
unmount `dismiss(link.id)` cleanup (already the pattern in `LinkRow`) covers a row
disappearing mid-hover while a show/hide timer is pending.

### 3. Inline source-line (HN + Twitter/X only)

In `PaletteLinkRow`, add source-specific sub-lines **below** the title row, mirroring
`LinkRow`'s inline blocks:

- `sourceData.kind === 'hacker_news'` → `{points} points · {comments} comments`
- `sourceData.kind === 'twitter'` → the tweet `text` (single-line ellipsis, no author
  prefix — the title already reads "… on X")

Same visual treatment as library (`--text-sm`, `--fnt`, single-line ellipsis), inset to
align under the palette row's title (the palette uses an 18px chip + `--s2-5` gap, tighter
than the library row, so the inset is computed for the palette's own layout — not reused
verbatim from `LinkRow`'s `--row-inset`).

### 4. The gate + settings UI

Shared helper (in the web layer, e.g. alongside `PaletteLinkRow` or a small lib):

```ts
function isPaletteSurfaceOn(source: { enabled: boolean; palette: boolean } | undefined) {
  return (source?.enabled ?? true) && (source?.palette ?? true);
}
```

- Read `useSettings()` in `PaletteLinkRow`; gate **both** the hover trigger and the inline
  line per source through `isPaletteSurfaceOn(settings?.plugins?.<kind>)`.
- `PluginsTab.tsx`: add one "Command palette" toggle row per plugin (all four), writing
  `plugins.<source>.palette` via the existing `setPluginField` transform
  (`lib/pluginSettings.ts`). Same toggle-row styling as the existing `inline`/`hover` rows.

## Files touched

- `packages/core/src/settings/schema.ts` — `palette` flag on 4 plugins, default, additive
  migration in `coerceLegacyPluginSource` + `normalizePluginsValue`.
- `packages/core/src/settings/schema.test.ts` (or the existing settings test) — migration
  preservation cases.
- `packages/web/src/api/types.ts` — mirror the `palette` field on the web `SettingsMap`
  plugin types.
- `packages/web/src/components/AppFrame.tsx` — hoist `HoverPreviewProvider`.
- `packages/web/src/components/CommandPalette.tsx` — `PaletteLinkRow`: hover triggers,
  inline lines, gate.
- `packages/web/src/components/SettingsTabs/PluginsTab.tsx` — palette toggle rows.
- `packages/web/src/lib/pluginSettings.ts` — only if `setPluginField` needs the new field
  key (likely already generic).

## Verification

- **Types + gate:** `pnpm turbo run check-types test` + `pnpm quality` green.
- **Migration test:** pre-palette stored blob upgrades with prior choices preserved.
- **Behavior (real app):** run the web app, capture/seed several same-author X links + an
  HN + a YouTube + a GitHub link + a plain article link; open the palette:
  - X/HN rows show the inline line; YouTube/GitHub/generic do not.
  - Hovering any of the four plugin rows shows the correct source card; hovering the plain
    article row shows the `GenericVariant` card (og:image + tags).
  - Toggling a plugin source's "Command palette" setting off hides both its inline line
    and its hover card in the palette, while the library row for the same source is
    unaffected; the generic link's hover is unaffected by any plugin toggle.
