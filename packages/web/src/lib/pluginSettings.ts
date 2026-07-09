import type { SettingsMap } from '../api/types';

/** The full `plugins` map shape (plan 026) — mirrors `SettingsMap['plugins']` verbatim; a local alias so this file's signatures stay readable. */
export type PluginsMap = SettingsMap['plugins'];

/** The allowlisted source keys inside `PluginsMap` — `hacker_news` | `github` | `youtube`. */
export type PluginSource = keyof PluginsMap;

/**
 * The fields settable on a given plugin source, keyed by source — mirrors
 * `@silo/core`'s `settingsSchema.plugins` shape per source EXACTLY:
 * `hacker_news` has `enabled`/`inline`/`hover`, `github`/`youtube` have only
 * `enabled`/`hover` (no `inline` — they're hover-only sources, see
 * `packages/core/src/settings/schema.ts`'s doc comment). Keying the field
 * type by source is what makes `setPluginField('github', 'inline', ...)` a
 * COMPILE error rather than a runtime footgun.
 */
type PluginFieldFor<S extends PluginSource> = keyof PluginsMap[S];

/**
 * Flips exactly one field on exactly one plugin source and returns a NEW,
 * FULL `PluginsMap` with every other field of every other source untouched
 * — the pure transform behind the Plugins tab's nested toggles (plan 026
 * U3). Callers pass this straight to `updateSettings.mutate({ plugins:
 * setPluginField(...) })`: the settings store replaces the WHOLE `plugins`
 * value on write (`core.setSetting('plugins', ...)` has no sub-key merge —
 * see `PluginsTab.tsx`'s pre-026 doc comment), so the full three-source
 * object has to be reconstructed here rather than sent as a partial patch.
 *
 * Flipping a source's `enabled` does NOT touch its other fields
 * (`inline`/`hover` survive untouched) — re-enabling a source after
 * disabling it restores whatever `inline`/`hover` choices were in place
 * before, rather than resetting them. Only the ONE `(sourceKey, field)` pair
 * requested changes; every other source's object is passed through by
 * reference (not a deep clone), so unrelated re-renders keyed off referential
 * equality (e.g. a memoized row) don't spuriously fire for sources this call
 * didn't touch.
 *
 * `field` is constrained via `PluginFieldFor<S>` to the fields `sourceKey`'s
 * schema actually has — `setPluginField(plugins, 'github', 'inline', true)`
 * fails to typecheck (`github` has no `inline`), which is the whole point:
 * it's impossible to accidentally set a field a source's schema rejects.
 */
export function setPluginField<S extends PluginSource>(
  plugins: PluginsMap,
  sourceKey: S,
  field: PluginFieldFor<S>,
  value: boolean,
): PluginsMap {
  return {
    ...plugins,
    [sourceKey]: {
      ...plugins[sourceKey],
      [field]: value,
    },
  };
}
