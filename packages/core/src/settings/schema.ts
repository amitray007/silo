import { z } from 'zod';

/**
 * The settings allowlist (plan 016) — every KNOWN key this store accepts,
 * each with its own Zod schema. Mirrors `source-data.ts`'s discipline: a
 * single, explicit, per-key schema is the ONE source of truth for what's
 * allowed to live in the `settings.value` jsonb column — an unknown key or a
 * value that fails its key's schema is REJECTED at the `core` write boundary
 * (never silently stored opaquely), same "reject, don't strip" posture
 * `source-data.ts`'s doc comment argues for.
 *
 * Adding a new setting is a one-file change: add a key here (+ its default
 * below in `SETTINGS_DEFAULTS`), no migration needed — the table itself has
 * no per-key columns to alter.
 *
 * Module-PRIVATE (not exported): every external consumer only ever needs the
 * derived `SettingKey`/`SettingValue`/`SettingsMap` types, `isSettingKey`, or
 * `parseSettingValue` — none of which require the raw Zod-schema map itself.
 * Keeping it unexported is what knip's deadcode gate caught (an exported
 * value with zero external importers) — the fix is narrowing the surface,
 * not silencing the finding.
 */
const settingsSchema = {
  theme: z.enum(['light', 'dark', 'system']),
  trashPurgeDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  /**
   * Enricher-kind -> per-feature toggles (plan 026). Keys mirror the
   * source-kinds `@silo/core`'s enrichment path knows about
   * (`source-data.ts`'s discriminated union). `link` has no enricher and no
   * rich card, so it's excluded. Each source has a master `enabled` plus the
   * render-surface flags it supports: `hacker_news` and `twitter` render both
   * an inline row line AND a hover preview (`inline`/`hover`); `github`/
   * `youtube` are hover-only.
   *
   * `enabled` gates the worker fetch for every source with a live enricher
   * (hacker_news/github/youtube/twitter). `twitter` now has one too
   * (live-enrichment slice): the worker fetches `api.fxtwitter.com`, an
   * undocumented, third-party, X-derived source — same "toggle it off to skip
   * the fetch" semantics as the others, and it degrades to a plain link on
   * failure like any enricher. (A tweet's rich data can ALSO still arrive
   * pre-extracted via the `silo ingest x` CLI's `/api/ingest` seam — the live
   * enricher is a second, independent path to the same `twitter` SourceData
   * shape, not a replacement for it.) `twitter` also renders an inline row
   * line (author + tweet text) alongside its hover card, mirroring
   * hacker_news, so it carries the same `inline`/`hover` pair (polish slice,
   * command-center).
   *
   * `.strict()` on every level so an unknown plugin key OR an unknown
   * feature-flag key in a PATCH body is rejected rather than silently accepted.
   */
  plugins: z
    .object({
      hacker_news: z
        .object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean() })
        .strict(),
      github: z.object({ enabled: z.boolean(), hover: z.boolean() }).strict(),
      youtube: z.object({ enabled: z.boolean(), hover: z.boolean() }).strict(),
      twitter: z.object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean() }).strict(),
    })
    .strict(),
} as const;

/** The allowlisted setting keys — `Object.keys(settingsSchema)` at the type level. */
export type SettingKey = keyof typeof settingsSchema;

/** The value type for a given known settings key, inferred from its Zod schema. */
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsSchema)[K]>;

/** The full settings map shape — every known key, its own value type. */
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

/** Sensible defaults returned when a key has never been written (plan 016 QA note). */
export const SETTINGS_DEFAULTS: SettingsMap = {
  theme: 'system',
  trashPurgeDays: 30,
  plugins: {
    hacker_news: { enabled: true, inline: true, hover: true },
    github: { enabled: true, hover: true },
    youtube: { enabled: true, hover: true },
    twitter: { enabled: true, inline: true, hover: true },
  },
};

/** `true` when `key` is one of the allowlisted setting keys. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingsSchema, key);
}

/**
 * Upgrades one plugin source's legacy shape to the current per-feature
 * object (plan 026 migration). Pre-026, `plugins.<source>` was a bare
 * `boolean`; that boolean fanned out to every field the CURRENT schema
 * defines for that source (`true`/`false` -> every flag on/off alike), so a
 * legacy "enabled" reads back as "enabled + every feature on", matching the
 * pre-026 behavior exactly (there was no way to have been "enabled but
 * hover-off" before this migration existed). `fields` is the exact set of
 * feature keys the source's schema accepts, driving the fan-out without
 * hardcoding per-source shape here.
 */
function coerceLegacyPluginSource<F extends string>(
  raw: unknown,
  fields: readonly F[],
  fallback: Record<F, boolean>,
): Record<F, boolean> {
  if (typeof raw === 'boolean') {
    return Object.fromEntries(fields.map((field) => [field, raw])) as Record<F, boolean>;
  }
  if (
    raw !== null &&
    typeof raw === 'object' &&
    fields.every((field) => typeof (raw as Record<string, unknown>)[field] === 'boolean') &&
    Object.keys(raw).length === fields.length
  ) {
    // Already the current per-feature shape — pass through untouched.
    return raw as Record<F, boolean>;
  }
  // Legacy-boolean and current-shape are the only recognized forms; a
  // partial/garbage object, an extra/missing key, or a missing source
  // entirely all fall back to that source's default independently — one
  // malformed source in a mixed blob never drags down its siblings.
  return fallback;
}

/**
 * Upgrades a legacy `plugins` value (plan 016: `{ hacker_news: boolean,
 * github: boolean, youtube: boolean }`) to the plan-026 per-feature shape
 * BEFORE Zod validation, so a pre-026 stored blob never fails re-validation
 * on read. Runs unconditionally ahead of `settingsSchema.plugins.parse(...)`
 * inside `parseSettingValue` — a value already in the new shape passes
 * through `coerceLegacyPluginSource` untouched (object branch), and Zod
 * still does the real validation afterward, so this function only ever
 * RESHAPES the three known source keys, never validates and never drops or
 * invents top-level keys — an unrecognized top-level key (e.g. a typo'd
 * plugin name, or a genuinely unknown one) is passed through UNCHANGED so
 * `settingsSchema.plugins`'s `.strict()` still rejects it exactly like any
 * other malformed write, preserving this module's "reject, don't strip"
 * boundary discipline (see the module doc comment above `settingsSchema`)
 * for anything this migration doesn't specifically know how to upgrade.
 * Exported (unlike the rest of this module's internals) purely so it's
 * unit-testable in isolation from the Postgres-backed `settings.ts`
 * integration suite — `parseSettingValue` is the only production caller.
 */
export function normalizePluginsValue(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const value = raw as Record<string, unknown>;
  const defaults = SETTINGS_DEFAULTS.plugins;
  return {
    ...value,
    hacker_news: coerceLegacyPluginSource(
      value.hacker_news,
      ['enabled', 'inline', 'hover'] as const,
      defaults.hacker_news,
    ),
    github: coerceLegacyPluginSource(value.github, ['enabled', 'hover'] as const, defaults.github),
    youtube: coerceLegacyPluginSource(
      value.youtube,
      ['enabled', 'hover'] as const,
      defaults.youtube,
    ),
    // A pre-twitter stored blob has no `twitter` key — `coerceLegacyPluginSource`
    // returns the default for a missing source, so it fills in
    // `{enabled,inline,hover}` and `.strict()` validation passes on the
    // upgraded object. A pre-INLINE stored twitter blob (`{enabled,hover}`,
    // written before this field existed) has the WRONG arity for the
    // fields list below (2 keys vs. 3 expected), so `coerceLegacyPluginSource`
    // treats it as unrecognized and falls back to the twitter default
    // (all-on) rather than partially upgrading it — correct for a feature
    // addition: there's no legacy value to preserve for a flag that didn't
    // exist yet.
    twitter: coerceLegacyPluginSource(
      value.twitter,
      ['enabled', 'inline', 'hover'] as const,
      defaults.twitter,
    ),
  };
}

/** Validates `value` against the schema for `key`, throwing a `ZodError` on failure — the single boundary check every write path (`setSetting`, the PATCH route) runs through. Runs the plan-026 `plugins` legacy-shape migration (`normalizePluginsValue`) ahead of validation so a pre-026 stored blob upgrades instead of failing re-validation on read. */
export function parseSettingValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const coerced = key === 'plugins' ? normalizePluginsValue(value) : value;
  return settingsSchema[key].parse(coerced) as SettingValue<K>;
}
