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
   * Enricher-kind -> on/off. Keys mirror the source-kinds `@silo/core`'s
   * enrichment path already knows about (`source-data.ts`'s discriminated
   * union) that are actually pluggable — `link` has no enricher to toggle,
   * so it's deliberately excluded from this record, and `twitter` has no
   * external-API enricher (its rich data comes from the page itself), so it
   * is likewise excluded here for now. `.strict()` so an unknown plugin key
   * in a PATCH body is rejected rather than silently accepted into the
   * stored record.
   */
  plugins: z
    .object({
      hacker_news: z.boolean(),
      github: z.boolean(),
      youtube: z.boolean(),
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
  plugins: { hacker_news: true, github: true, youtube: true },
};

/** `true` when `key` is one of the allowlisted setting keys. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingsSchema, key);
}

/** Validates `value` against the schema for `key`, throwing a `ZodError` on failure — the single boundary check every write path (`setSetting`, the PATCH route) runs through. */
export function parseSettingValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return settingsSchema[key].parse(value) as SettingValue<K>;
}
