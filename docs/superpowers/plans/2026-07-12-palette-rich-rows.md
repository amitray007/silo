# Command-palette rich rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give web command-palette link rows the library's hover popover (all links, incl. generic) and an inline source-line (HN + Twitter/X only), gated by a new independent per-plugin `palette` flag.

**Architecture:** Add a `palette` boolean to each of the four plugin sources in the settings allowlist (`@silo/core`), with an *additive* legacy migration so existing stored `enabled`/`inline`/`hover` choices are preserved when the new field appears. Mirror the field in the web `SettingsMap`. Hoist `HoverPreviewProvider` in `AppFrame` so the palette (a sibling of `<main>`) sits under it, then wire `PaletteLinkRow` to trigger the shared hover card (gated per plugin at the *trigger*, ungated for generic links) and render HN/Twitter inline lines. Add one "Command palette" toggle row per plugin in the Plugins settings tab.

**Tech Stack:** TypeScript, React, `cmdk`, Zod (settings allowlist), Vitest, `@silo/core` / `@silo/web` in a pnpm+turbo monorepo.

## Global Constraints

- **No API/DB/route changes.** Settings is a jsonb allowlist keyed by `SettingKey`; adding a field needs no migration table. `sourceData` already flows to palette results.
- **`@silo/db` must not import `@silo/core`**, and **`@silo/web` must not import `@silo/core`** (browser bundle can't load `pg`). The web `SettingsMap` in `packages/web/src/api/types.ts` is a hand-mirrored copy — keep it field-for-field with core.
- **`.strict()` everywhere in the settings schema.** An unknown plugin key or feature-flag key in a PATCH body is rejected, not stripped.
- **Optimistic defaults:** every render gate defaults to SHOWING while settings load (`?? true`), matching the app's existing loading optimism.
- **Privacy:** hover images always go through silo's own `/api/preview-image` proxy — reusing the existing `HoverPreview` card preserves this automatically; do not add any third-party image fetch.
- **Design tokens only** (`--text-sm`, `--fnt`, etc.) — no hardcoded colors/sizes. Geist Sans, the Oat ramp; "silence means complete."
- **Commit message trailer** on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Branch:** already on `feat/palette-rich-rows` (never commit to `main`).
- **Done-gate:** `pnpm turbo run check-types test` + `pnpm quality` green before a task is "done".

---

### Task 1: Add the `palette` flag to the core settings schema + additive migration

**Files:**
- Modify: `packages/core/src/settings/schema.ts`
- Test: `packages/core/src/settings/schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SETTINGS_DEFAULTS.plugins.<source>.palette === true` for all four sources; each plugin source object now has a `palette: boolean` field; `normalizePluginsValue` fills a missing `palette` (and any single missing newer field) rather than resetting the source.

**The migration contract (read carefully — it changes one intentional prior behavior).**
`coerceLegacyPluginSource` currently accepts a stored object only when it matches the field list on *exact arity* (`Object.keys(raw).length === fields.length`); anything else (partial, extra key, or a valid-but-shorter older shape) falls back to the source default. Adding `palette` to each `fields` list would make every already-stored blob (which lacks `palette`) fail that arity check and reset — wiping the user's saved choices.

New rule for the object branch — accept and **fill-forward** when ALL of:
1. every key present in `raw` is one of `fields` (no unknown/extra key), AND
2. every present value is a `boolean`, AND
3. the two universal fields **`enabled` and `hover` are both present** (every source has these; this is what still rejects a too-partial `{enabled}`-only blob).

When accepted, return `{ ...fallback, ...onlyBooleanFieldsFromRaw }` — i.e. start from the source default (so any missing newer field like `palette` gets its default) and overlay the stored boolean fields. Otherwise (unknown/extra key, non-boolean value, or missing `enabled`/`hover`) fall back to `fallback` exactly as today.

This **preserves**: full-current-shape passthrough; legacy-boolean fan-out (handled in the `typeof raw === 'boolean'` branch, unchanged); missing-source → default; extra-key → default (rule 1); garbage-types → default (rule 2); `{enabled}`-only → default (rule 3).
This **intentionally changes**: a `{enabled,hover}` pre-inline twitter blob now fills forward to `{enabled,hover,inline:true,palette:true}` instead of resetting — the safer no-data-loss behavior (see spec's migration note). One existing test asserts the old reset behavior and must be updated (Step 6 below).

- [ ] **Step 1: Add `palette` to the schema, defaults**

In `packages/core/src/settings/schema.ts`, add `palette: z.boolean()` to all four plugin objects in `settingsSchema.plugins`:

```ts
  plugins: z
    .object({
      hacker_news: z
        .object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean(), palette: z.boolean() })
        .strict(),
      github: z.object({ enabled: z.boolean(), hover: z.boolean(), palette: z.boolean() }).strict(),
      youtube: z.object({ enabled: z.boolean(), hover: z.boolean(), palette: z.boolean() }).strict(),
      twitter: z
        .object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean(), palette: z.boolean() })
        .strict(),
    })
    .strict(),
```

And in `SETTINGS_DEFAULTS.plugins`:

```ts
  plugins: {
    hacker_news: { enabled: true, inline: true, hover: true, palette: true },
    github: { enabled: true, hover: true, palette: true },
    youtube: { enabled: true, hover: true, palette: true },
    twitter: { enabled: true, inline: true, hover: true, palette: true },
  },
```

- [ ] **Step 2: Rewrite `coerceLegacyPluginSource`'s object branch to fill-forward**

Replace the object-branch (the `if (raw !== null && typeof raw === 'object' && ...)` block and its trailing comment) with the fill-forward rule. Full new function body:

```ts
function coerceLegacyPluginSource<F extends string>(
  raw: unknown,
  fields: readonly F[],
  fallback: Record<F, boolean>,
): Record<F, boolean> {
  if (typeof raw === 'boolean') {
    return Object.fromEntries(fields.map((field) => [field, raw])) as Record<F, boolean>;
  }
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const keys = Object.keys(obj);
    const fieldSet = new Set<string>(fields);
    // Accept + fill-forward an object whose keys are all known fields, whose
    // present values are all booleans, and which carries at least the two
    // universal fields (`enabled` + `hover`). This upgrades an older, SHORTER
    // valid shape (e.g. one written before `palette` was added) by filling the
    // missing newer field(s) from `fallback` while preserving the stored
    // choices — no data loss when a new feature flag is introduced. A stray/
    // unknown key, a non-boolean value, or a too-partial blob (missing
    // `enabled` or `hover`) is still treated as garbage and falls back to
    // `fallback`, preserving the module's "reject, don't silently keep a
    // malformed source" posture.
    const allKnown = keys.every((k) => fieldSet.has(k));
    const allBool = keys.every((k) => typeof obj[k] === 'boolean');
    const hasUniversal = typeof obj.enabled === 'boolean' && typeof obj.hover === 'boolean';
    if (allKnown && allBool && hasUniversal) {
      const filled: Record<string, boolean> = { ...fallback };
      for (const k of keys) filled[k] = obj[k] as boolean;
      return filled as Record<F, boolean>;
    }
  }
  return fallback;
}
```

- [ ] **Step 3: Add `palette` to `normalizePluginsValue` field-lists**

In `normalizePluginsValue`, add `'palette'` to each source's field-list literal:

```ts
    hacker_news: coerceLegacyPluginSource(
      value.hacker_news,
      ['enabled', 'inline', 'hover', 'palette'] as const,
      defaults.hacker_news,
    ),
    github: coerceLegacyPluginSource(
      value.github,
      ['enabled', 'hover', 'palette'] as const,
      defaults.github,
    ),
    youtube: coerceLegacyPluginSource(
      value.youtube,
      ['enabled', 'hover', 'palette'] as const,
      defaults.youtube,
    ),
    twitter: coerceLegacyPluginSource(
      value.twitter,
      ['enabled', 'inline', 'hover', 'palette'] as const,
      defaults.twitter,
    ),
```

- [ ] **Step 4: Write the new migration tests (failing first)**

Add to `packages/core/src/settings/schema.test.ts` inside `describe('normalizePluginsValue ...')`:

```ts
  it('fills a missing `palette` field forward, preserving prior enabled/inline/hover choices', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: false, inline: false, hover: true }, // pre-palette shape
        github: { enabled: true, hover: false },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: false, hover: true },
      }),
    ).toEqual({
      hacker_news: { enabled: false, inline: false, hover: true, palette: true },
      github: { enabled: true, hover: false, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: false, hover: true, palette: true },
    });
  });

  it('a too-partial source (missing hover) still falls back to that source default', () => {
    expect(normalizePluginsValue({ hacker_news: { enabled: true } })).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: SETTINGS_DEFAULTS.plugins.github,
      youtube: SETTINGS_DEFAULTS.plugins.youtube,
      twitter: SETTINGS_DEFAULTS.plugins.twitter,
    });
  });
```

- [ ] **Step 5: Update the four existing tests that hardcode the pre-`palette` shape**

These existing assertions embed source objects WITHOUT `palette` and must gain it (they are correct-shape passthroughs that now include `palette`). Update every literal in `schema.test.ts` that spells out a full source object to include `palette: true` where the object represents a "kept/passed-through" value:
- `'a source already in the new shape passes through untouched'` (lines ~20-28): add `palette: true` (or `false`) to each of the four objects **and** they'll pass through unchanged — so make the input already include `palette` (e.g. `hacker_news: { enabled: true, inline: false, hover: true, palette: true }`, etc.). This test asserts passthrough, so input === output; just add the field to the input.
- `'a mix of legacy booleans and new-shape objects...'` (lines ~30-44): the new-shape inputs (`github: { enabled: false, hover: true }`, `twitter: { enabled: true, inline: false, hover: false }`) now FILL-FORWARD `palette:true`; update expected to `github: { enabled: false, hover: true, palette: true }` and `twitter: { enabled: true, inline: false, hover: false, palette: true }`. The legacy-boolean fan-outs (`hacker_news: true`, `youtube: false`) fan out to every field INCLUDING palette, so `hacker_news: { enabled: true, inline: true, hover: true, palette: true }` and `youtube: { enabled: false, hover: false, palette: false }`.
- `'a pre-twitter stored blob...'` (lines ~55-72): the three present sources fill-forward `palette:true`; update expected `hacker_news`/`github`/`youtube` to include `palette: true`.
- `'a legacy boolean blob parses successfully...'` in the `parseSettingValue` describe (lines ~194-203): legacy-boolean fan-out now includes `palette`; update expected non-twitter sources to include `palette` matching the source boolean (`hacker_news: {...palette:true}`, `github: {enabled:false,hover:false,palette:false}`, `youtube: {...palette:true}`).
- `'accepts the new nested per-feature shape'` and `'a stray field...'` and `'rejects a stray top-level plugin key'` and `SETTINGS_DEFAULTS.plugins is all-true`: add `palette` to each spelled-out full source object so the input is a valid current shape; for the strict-accept test the input must include `palette` on every source.

- [ ] **Step 6: Update the one test whose behavior INTENTIONALLY changes**

Replace the test at lines ~106-120 (`'a pre-inline stored twitter blob (`{enabled,hover}`... falls back to the twitter default...'`). Its premise (a shorter valid shape resets) is now reversed — it fills forward. Rewrite:

```ts
  it('a pre-inline stored twitter blob (`{enabled,hover}`) now fills forward its missing fields (inline+palette) instead of resetting — additive migration preserves the stored enabled/hover choice', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: false, hover: false }, // pre-inline twitter shape (2 keys)
      }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      // enabled/hover preserved from storage; inline + palette filled from default
      twitter: { enabled: false, inline: true, hover: false, palette: true },
    });
  });
```

Also update the `coerceLegacyPluginSource` doc comment block above the function and the twitter-branch comment in `normalizePluginsValue` (schema.ts ~lines 182-191) to describe fill-forward instead of exact-arity reset.

- [ ] **Step 7: Run the core settings tests**

Run: `pnpm --filter @silo/core test -- settings`
Expected: PASS (schema.test.ts + settings.test.ts). If `settings.test.ts:166` (`'a stray field ... falls back'`) fails, confirm its input still has an *extra* key (`evil: true`) — rule 1 must still reject it. If `settings.test.ts:113`/`:183` (missing-source / pre-twitter) fail, they need the same `palette: true` fill-forward updates as Step 5.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/settings/schema.ts packages/core/src/settings/schema.test.ts
git commit -m "feat(settings): per-plugin \`palette\` flag with additive legacy migration

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Mirror the `palette` field in the web SettingsMap

**Files:**
- Modify: `packages/web/src/api/types.ts:208-218` (the `plugins` block in `SettingsMap`)

**Interfaces:**
- Consumes: nothing.
- Produces: web `SettingsMap['plugins'].<source>.palette: boolean` — makes `settings?.plugins?.<source>?.palette` type-check in Tasks 4-5 and `setPluginField(plugins, source, 'palette', v)` type-check in Task 6.

- [ ] **Step 1: Add `palette` to each source in the web `SettingsMap`**

In `packages/web/src/api/types.ts`, update the `plugins` block:

```ts
  plugins: {
    hacker_news: { enabled: boolean; inline: boolean; hover: boolean; palette: boolean };
    github: { enabled: boolean; hover: boolean; palette: boolean };
    youtube: { enabled: boolean; hover: boolean; palette: boolean };
    twitter: { enabled: boolean; inline: boolean; hover: boolean; palette: boolean };
  };
```

Update the `plugins` doc comment just above (`~lines 187-192`) to note the new `palette` flag: "each source also has a `palette` flag gating its command-palette hover + inline surfaces (independent of `inline`/`hover`, which gate the library surfaces)."

- [ ] **Step 2: Typecheck the web package**

Run: `pnpm --filter @silo/web check-types`
Expected: PASS. (`LOADING_PLUGINS` in `PluginsTab.tsx` will now be a type error — missing `palette`. That's expected; it's fixed in Task 6. If you want a green checkpoint here, add `palette: true` to each `LOADING_PLUGINS` source now — it's harmless and Task 6 relies on it.)

Add `palette: true` to each source in `LOADING_PLUGINS` (`packages/web/src/components/SettingsTabs/PluginsTab.tsx:17-22`) so this task's typecheck is green:

```ts
const LOADING_PLUGINS: PluginsMap = {
  hacker_news: { enabled: true, inline: true, hover: true, palette: true },
  github: { enabled: true, hover: true, palette: true },
  youtube: { enabled: true, hover: true, palette: true },
  twitter: { enabled: true, inline: true, hover: true, palette: true },
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/components/SettingsTabs/PluginsTab.tsx
git commit -m "feat(web): mirror per-plugin \`palette\` flag in web SettingsMap

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Hoist `HoverPreviewProvider` so it wraps the command palette

**Files:**
- Modify: `packages/web/src/components/AppFrame.tsx:352-365`

**Interfaces:**
- Consumes: nothing.
- Produces: `<CommandPalette>` now renders INSIDE `<HoverPreviewProvider>`, so `PaletteLinkRow` (Task 5) can call `useHoverPreview()` without a null-context throw.

**Context:** Today `<HoverPreviewProvider>` wraps only `<main>`'s inner subtree; `<CommandPalette>` is a sibling of `<main>` two `</div>` levels below it. The provider is portal-based (renders into `document.body`), so moving it up the tree has zero visual/DOM-clipping effect — it only changes which components can consume its context. `RowMenuProvider`/`SelectionProvider` stay wrapping `<main>` only (the palette doesn't consume those).

- [ ] **Step 1: Move `<HoverPreviewProvider>` to wrap both `<main>` and `<CommandPalette>`**

Current structure (AppFrame.tsx ~352-365):

```tsx
          <main className="silo-content">
            <RowMenuProvider>
              <SelectionProvider>
                <HoverPreviewProvider>
                  <Outlet />
                  <RowMenuLayer palette={commandPalette} />
                </HoverPreviewProvider>
              </SelectionProvider>
            </RowMenuProvider>
          </main>
        </div>
        <SettingsLayer />
        <CommandPalette palette={commandPalette} />
      </div>
```

Change to (provider hoisted to wrap the `.silo-band` div's `</div>`, `SettingsLayer`, and `CommandPalette`; `RowMenu`/`Selection` unchanged inside `<main>`):

```tsx
          <HoverPreviewProvider>
            <main className="silo-content">
              <RowMenuProvider>
                <SelectionProvider>
                  <Outlet />
                  <RowMenuLayer palette={commandPalette} />
                </SelectionProvider>
              </RowMenuProvider>
            </main>
          </div>
          <SettingsLayer />
          <CommandPalette palette={commandPalette} />
        </HoverPreviewProvider>
```

IMPORTANT: the `</div>` that closes `.silo-band` (the one currently on the line after `</main>`) must stay closing `.silo-band` — verify the JSX nesting by eye. The `<HoverPreviewProvider>` open tag goes just BEFORE `<main className="silo-content">`, and its close tag goes just AFTER `<CommandPalette ... />`, so it wraps `<main>`, the `.silo-band`-closing `</div>`, `<SettingsLayer/>`, and `<CommandPalette/>`. Do NOT move `RowMenuLayer` out of `<main>` — it stays where it is (it renders the shared EditModal for library rows). Note `RowMenuLayer` currently sits inside `HoverPreviewProvider`; after the change it still does (the provider now wraps a superset).

Update the doc comment at AppFrame.tsx ~347-350 to note the provider now spans the palette too.

- [ ] **Step 2: Typecheck + verify the app still renders (no hover wiring yet)**

Run: `pnpm --filter @silo/web check-types`
Expected: PASS.

Manual smoke (done later in Task 7's browser QA, but a quick check now is fine): the library hover preview must still work exactly as before — the provider still wraps `<main>`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/AppFrame.tsx
git commit -m "refactor(web): hoist HoverPreviewProvider to wrap the command palette

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Add the palette-surface gate helper

**Files:**
- Create: `packages/web/src/lib/paletteSurface.ts`
- Test: `packages/web/src/lib/paletteSurface.test.ts`

**Interfaces:**
- Consumes: web `SettingsMap` plugin source types (Task 2).
- Produces: `isPaletteSurfaceOn(source: { enabled: boolean; palette: boolean } | undefined): boolean` — used by `PaletteLinkRow` (Task 5) to gate both the hover trigger and the inline line for a plugin source.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/paletteSurface.test.ts
import { describe, expect, it } from 'vitest';
import { isPaletteSurfaceOn } from './paletteSurface';

describe('isPaletteSurfaceOn', () => {
  it('is on when both enabled and palette are true', () => {
    expect(isPaletteSurfaceOn({ enabled: true, palette: true })).toBe(true);
  });
  it('is off when the source is disabled', () => {
    expect(isPaletteSurfaceOn({ enabled: false, palette: true })).toBe(false);
  });
  it('is off when the palette flag is off', () => {
    expect(isPaletteSurfaceOn({ enabled: true, palette: false })).toBe(false);
  });
  it('defaults to ON while settings are still loading (undefined)', () => {
    expect(isPaletteSurfaceOn(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @silo/web test -- paletteSurface`
Expected: FAIL ("Cannot find module './paletteSurface'").

- [ ] **Step 3: Implement**

```ts
// packages/web/src/lib/paletteSurface.ts

/**
 * Whether a plugin source's COMMAND-PALETTE surface (its hover preview + inline
 * line inside the cmd-k palette) should render: the source's plugin must be
 * `enabled` AND its `palette` feature on. Defaults to ON while settings are
 * still loading (`source` undefined), matching the app's optimism elsewhere
 * (mirrors `HoverPreview.tsx`'s `hoverEnabledFor` and `LinkRow`'s
 * `isInlineSurfaceOn`, but for the palette's own independent `palette` flag —
 * NOT the library `inline`/`hover` flags). Generic non-plugin links are not
 * routed through this gate at all — their palette hover always shows, matching
 * the library's `GenericVariant`.
 */
export function isPaletteSurfaceOn(
  source: { enabled: boolean; palette: boolean } | undefined,
): boolean {
  return (source?.enabled ?? true) && (source?.palette ?? true);
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @silo/web test -- paletteSurface`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/paletteSurface.ts packages/web/src/lib/paletteSurface.test.ts
git commit -m "feat(web): isPaletteSurfaceOn gate helper for palette rows

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Wire hover + inline lines into `PaletteLinkRow`

**Files:**
- Modify: `packages/web/src/components/CommandPalette.tsx` (imports; `PaletteLinkRow`)

**Interfaces:**
- Consumes: `useHoverPreview()` (from `./HoverPreviewContext`), `isPaletteSurfaceOn` (Task 4), `useSettings()` (from `../api/hooks`), `isHoverCapable()` (from `../lib/pointer`). `PaletteLinkResult` already carries full `sourceData`.
- Produces: palette link rows that (a) trigger the shared hover card on enter for every link — gated per plugin source, ungated for generic; (b) render an HN/Twitter inline line under the title.

**Notes for the implementer:**
- `PaletteLinkResult = LinkJson | SearchResultJson | TrashLinkJson`. `SearchResultJson`/`TrashLinkJson` are structurally `LinkJson` plus extra fields, so passing one to `scheduleShow(link: LinkJson, ...)` type-checks.
- `PaletteLinkRow` is a plain child inside the `cmdk` `Command.Item`. The row's own DOM element for `getBoundingClientRect()` is the outer `<span>` this component already returns — attach the hover handlers and a ref there.
- Gate mapping: `sourceData.kind` of `hacker_news`/`github`/`youtube`/`twitter` → gated by `isPaletteSurfaceOn(settings?.plugins?.<kind>)`. Any other kind (`link`) → ungated (always show).
- Inline line: only `hacker_news` and `twitter`, only when that source's `isPaletteSurfaceOn(...)` is true (same gate as the hover — one `palette` flag governs both surfaces).
- Unmount cleanup: call `dismiss(link.id)` on unmount (rows unmount as the user types / list re-renders).

- [ ] **Step 1: Add imports**

At the top of `CommandPalette.tsx`, add:

```ts
import { useEffect, useMemo, useRef } from 'react';
```
becomes (add `useSettings`; keep existing hook imports) — add to the `../api/hooks` import list:
```ts
  useSettings,
```
and add these new imports:
```ts
import { useSettings } from '../api/hooks'; // fold into the existing hooks import instead of a 2nd line
import { isHoverCapable } from '../lib/pointer';
import { isPaletteSurfaceOn } from '../lib/paletteSurface';
import { useHoverPreview } from './HoverPreviewContext';
```
(Fold `useSettings` into the existing `from '../api/hooks'` import block rather than adding a duplicate import line — Biome will flag a duplicate.)

- [ ] **Step 2: Replace `PaletteLinkRow` with the hover+inline version**

Replace the whole `PaletteLinkRow` function (CommandPalette.tsx ~113-166) with:

Add `SettingsMap` to the existing `../api/types` import block, then define the gate mapper and the row. Use exactly this `palettePluginOn` (typed against `SettingsMap['plugins']` — do NOT hand-roll a conditional-type version):

```tsx
/**
 * Whether this link's palette hover + inline surface should show. Plugin
 * sources (hacker_news/github/youtube/twitter) are gated by their own
 * `palette` flag via `isPaletteSurfaceOn`; any other kind (a plain `link`) is
 * ungated — its `GenericVariant` hover always shows, matching the library.
 */
function palettePluginOn(
  kind: PaletteLinkResult['sourceData']['kind'],
  plugins: SettingsMap['plugins'] | undefined,
): boolean {
  if (kind === 'hacker_news' || kind === 'github' || kind === 'youtube' || kind === 'twitter') {
    return isPaletteSurfaceOn(plugins?.[kind]);
  }
  return true; // generic link — always show hover
}

/** A single link result row (favicon + title + domain), scaled down from `LinkRow`'s look for the palette's tighter list. `Command.Item`'s own `onSelect` handles both click and Enter-while-active — no separate keydown handler needed. Renders trash-scope rows identically to library/tag ones (see `PaletteLinkResult`'s doc comment). Hover preview + inline source-line mirror the library row (`LinkRow`), gated per plugin by the palette `palette` flag; a generic link always gets its hover card. */
function PaletteLinkRow({ link }: { link: PaletteLinkResult }) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const rowRef = useRef<HTMLSpanElement>(null);
  const { data: settings } = useSettings();
  const { scheduleShow, scheduleHide, dismiss } = useHoverPreview();

  const kind = link.sourceData.kind;
  const surfaceOn = palettePluginOn(kind, settings?.plugins);
  const showInline =
    surfaceOn && (kind === 'hacker_news' || kind === 'twitter');

  // Mirror LinkRow's hover triggers: schedule the shared card on enter,
  // hide on leave, dismiss on unmount (the row unmounts as the list
  // re-renders while typing). Suppress when the source's palette surface is
  // off or the pointer can't hover (touch) — `scheduleShow`'s `suppress`
  // path cancels any pending timer without opening.
  const handleEnter = () => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    scheduleShow(link, rect, { suppress: !surfaceOn || !isHoverCapable() });
  };
  const handleLeave = () => scheduleHide(link.id);
  useEffect(() => () => dismiss(link.id), [dismiss, link.id]);

  return (
    <span
      ref={rowRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-0-5)',
        width: '100%',
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2-5)',
          width: '100%',
          minWidth: 0,
        }}
      >
        <Chip domain={domain} size={18} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--s2-5)',
          }}
        >
          <span
            style={{
              fontWeight: 500,
              fontSize: 'var(--text-base)',
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
          <span
            style={{
              flex: 'none',
              maxWidth: '14rem',
              fontSize: 'var(--text-base)',
              color: 'var(--fnt)',
              fontWeight: 400,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {domain}
          </span>
        </span>
      </span>
      {showInline && link.sourceData.kind === 'hacker_news' && (
        <span
          style={{
            // Align under the title: 18px chip + --s2-5 gap.
            paddingLeft: 'calc(18px + var(--s2-5))',
            fontSize: 'var(--text-sm)',
            color: 'var(--fnt)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {link.sourceData.points} points · {link.sourceData.comments} comments
        </span>
      )}
      {showInline && link.sourceData.kind === 'twitter' && (
        <span
          style={{
            paddingLeft: 'calc(18px + var(--s2-5))',
            fontSize: 'var(--text-sm)',
            color: 'var(--fnt)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {link.sourceData.text}
        </span>
      )}
    </span>
  );
}
```

The `../api/types` import block becomes (add `SettingsMap`):

```ts
import type {
  LinkJson,
  SearchResultJson,
  SettingsMap,
  TagCount,
  TrashLinkJson,
  TrashSearchResultJson,
} from '../api/types';
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @silo/web check-types && pnpm --filter @silo/web lint`
Expected: PASS. Common issues: duplicate import of `useSettings` (fold it into the hooks block); `useRef`/`useEffect` already imported (they are — `useEffect` and `useRef` are in the existing top import). Verify no unused import remains.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/CommandPalette.tsx
git commit -m "feat(web): palette rows gain hover preview + HN/Twitter inline line

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Add the "Command palette" toggle rows to the Plugins settings tab

**Files:**
- Modify: `packages/web/src/components/SettingsTabs/PluginsTab.tsx` (`FEATURE_ROWS_BY_SOURCE`)

**Interfaces:**
- Consumes: `setPluginField` (already generic over `PluginFieldFor<S>`; `palette` is now a valid field for every source via Task 2), the web `SettingsMap` (Task 2).
- Produces: a "Command palette" toggle per plugin, writing `plugins.<source>.palette`.

**Notes:** `FEATURE_ROWS_BY_SOURCE`'s value type is `ReadonlyArray<{ field: 'inline' | 'hover'; ... }>`. Widen `field` to include `'palette'`. `FeatureToggleRow`'s `field` prop is already typed `string`. The `writeField(source.key, row.field as keyof PluginsMap[...], ...)` cast in the tab already handles arbitrary fields, so no other change is needed — `palette` is a valid `keyof PluginsMap[S]` for all four sources now.

- [ ] **Step 1: Widen the `field` union and add a `palette` row to every source**

In `PluginsTab.tsx`, change the `FEATURE_ROWS_BY_SOURCE` type annotation:

```ts
const FEATURE_ROWS_BY_SOURCE: Record<
  PluginSource,
  ReadonlyArray<{ field: 'inline' | 'hover' | 'palette'; name: string; desc: string }>
> = {
```

Append a `palette` row to each source's array (after its existing rows):

```ts
  hacker_news: [
    { field: 'inline', name: 'Inline on the row', desc: 'Points and comments shown directly in the list' },
    { field: 'hover', name: 'On hover (preview card)', desc: 'Points and comments in the hover preview' },
    { field: 'palette', name: 'In the command palette', desc: 'Hover card + inline points/comments in the ⌘K palette' },
  ],
  github: [
    { field: 'hover', name: 'On hover (preview card)', desc: 'Stars, forks, and issues in the hover preview' },
    { field: 'palette', name: 'In the command palette', desc: 'Hover card in the ⌘K palette' },
  ],
  youtube: [
    { field: 'hover', name: 'On hover (preview card)', desc: 'Thumbnail and channel in the hover preview' },
    { field: 'palette', name: 'In the command palette', desc: 'Hover card in the ⌘K palette' },
  ],
  twitter: [
    { field: 'inline', name: 'Inline on the row', desc: 'Author and tweet text shown directly in the list' },
    { field: 'hover', name: 'On hover (preview card)', desc: 'Author, text, and engagement in the hover preview' },
    { field: 'palette', name: 'In the command palette', desc: 'Hover card + inline tweet text in the ⌘K palette' },
  ],
```

(Keep the existing rows' exact text; only append the `palette` row. `LOADING_PLUGINS` already gained `palette: true` in Task 2 Step 2.)

- [ ] **Step 2: Typecheck + lint + full web test**

Run: `pnpm --filter @silo/web check-types && pnpm --filter @silo/web lint && pnpm --filter @silo/web test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/SettingsTabs/PluginsTab.tsx
git commit -m "feat(web): per-plugin 'Command palette' toggle in the Plugins settings tab

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Whole-tree gate + browser QA

**Files:** none (verification only).

- [ ] **Step 1: Run the full quality gate**

Run: `pnpm turbo run check-types test && pnpm quality`
Expected: GREEN across the whole tree. Attribute any RED to files this branch touched; a failure in an unrelated `.claude/worktrees/*` path or unrelated WIP is not this unit's to fix (per CLAUDE.md's done-gate rules) — surface it, don't paper over it.

- [ ] **Step 2: Browser QA (see the QA brief handed to the orchestrator)**

Bring up Postgres + the app (`pnpm db:up` then `pnpm dev`), seed one link of each kind (an X post, an HN item, a YouTube video, a GitHub repo, a plain article) plus several same-author X posts, then in the browser:
- Open the palette (⌘K / `/`), type a query returning the X posts → each X row shows the tweet-text inline line; rows are now distinguishable.
- Hover an X row → the Twitter hover card appears (author, text, engagement).
- Hover the YouTube / GitHub / HN / plain-article rows → the correct card (source variant; generic for the article) appears; YouTube/GitHub/article show NO inline line.
- Settings → Plugins → Twitter → toggle "In the command palette" OFF → the X rows lose both their inline line and hover card in the palette, while the library X row is unaffected.
- Toggle it back ON → both return.

Capture before/after screenshots as evidence.

- [ ] **Step 3: Final commit (if QA required any fix)** — otherwise nothing to commit here.
