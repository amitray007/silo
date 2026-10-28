import { aiProviders, db, settings } from '@silo/db';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { parseStoredModels, storedProviderModels } from '../ai/model-store.js';
import type { Executor } from '../links/executor.js';
import {
  isSettingKey,
  parseSettingValue,
  parseStoredSettingValue,
  SETTINGS_DEFAULTS,
  type SettingKey,
  type SettingsMap,
  type SettingValue,
} from './schema.js';

/**
 * Settings ops (plan 016) — the ONLY `core` module that touches
 * `@silo/db`'s `settings` table. Single-user/localhost store: a "row per
 * known key" key-value table, validated per-key against the allowlist in
 * `schema.ts`. Every unset key falls back to `SETTINGS_DEFAULTS` — there is
 * no migration/backfill step for a fresh install; a brand-new database with
 * zero rows in `settings` still answers every read with a sensible default
 * (see `getAllSettings`'s doc comment).
 */

/**
 * Non-throwing variant of `parseSettingValue`: a stored value that fails
 * validation against the CURRENT schema (e.g. hand-edited in the DB, or left
 * over from a since-narrowed schema) falls back to `undefined` instead of
 * throwing — used by both `getSetting` and `getAllSettings` so a single
 * corrupted row degrades to that one key's default rather than surfacing an
 * uncaught 500 on an otherwise-unrelated read.
 */
async function parseSettingValueSafely<K extends SettingKey>(
  key: K,
  value: unknown,
  executor: Executor = db,
  repairModels = true,
): Promise<SettingValue<K> | undefined> {
  try {
    const parsed = parseStoredSettingValue(key, value);
    if (key === 'ai' && repairModels) {
      const ai = parsed as SettingValue<'ai'>;
      for (const feature of Object.values(ai.features)) {
        const model = feature.model;
        if (!model) continue;
        const models = await storedProviderModels(model.provider, executor);
        if (!models.some((m) => m.id === model.id)) feature.model = null;
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Reads one setting by key, falling back to its default when unset OR when
 * the stored value fails re-validation against the CURRENT schema (via
 * `parseSettingValueSafely` — review fix, ce-correctness: an earlier version
 * called the THROWING `parseSettingValue` directly here, which meant a
 * hand-edited/corrupted row would throw uncaught out of this function
 * instead of degrading to the default the way `getAllSettings` already did
 * for the exact same failure mode — the two reads disagreed on behavior for
 * an identical condition). Throws only when `key` itself isn't a known
 * `SettingKey` — callers are expected to only ever pass one, so that's a
 * caller bug, not a runtime condition to handle gracefully.
 *
 * Re-validates the stored value against the CURRENT schema on every read
 * (not just on write) — cheap for a table this small, and it means a schema
 * tightened in a later slice can't silently keep serving a value that would
 * no longer validate.
 */
export async function getSetting<K extends SettingKey>(
  key: K,
  executor: Executor = db,
): Promise<SettingValue<K>> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (!row) return SETTINGS_DEFAULTS[key];

  const parsed = await parseSettingValueSafely(key, row.value, executor);
  return parsed ?? SETTINGS_DEFAULTS[key];
}

/**
 * Writes one setting, validating `value` against `key`'s schema BEFORE the
 * write — an invalid value never reaches the database (mirrors
 * `recordEnrichment`'s "validate at the boundary" discipline). Upserts on
 * the `key` primary key (`onConflictDoUpdate`) so a repeated write to the
 * same key is idempotent, not a unique-violation.
 *
 * Takes an optional `Executor` (the pooled `db` singleton, or a transaction
 * handle — same shared type `links.ts`'s `createLink` uses) so
 * `updateSettings` can run every key's write inside ONE transaction; direct
 * callers can omit it. AI writes use a transaction so the live-list row
 * stays locked from selection validation through persistence.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  executor: Executor = db,
): Promise<void> {
  const parsed = parseSettingValue(key, value);
  if (key === 'ai') {
    await executor.transaction(async (tx) => {
      await validateProviderSelection(parsed as SettingValue<'ai'>, tx);
      await persistSetting(key, parsed, tx);
    });
  } else {
    await persistSetting(key, parsed, executor);
  }
}

async function persistSetting<K extends SettingKey>(
  key: K,
  parsed: SettingValue<K>,
  executor: Executor,
): Promise<void> {
  await executor
    .insert(settings)
    .values({ key, value: parsed })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt: new Date() } });
}

/**
 * Reads the FULL settings map in one query — every allowlisted key, each
 * either the stored value (re-validated, same as `getSetting`) or its
 * default when unset/invalid. This is what the web Settings modal hydrates
 * from on load: a single round-trip that always returns every known key,
 * never a partial map the UI would have to fill in itself.
 */
export async function getAllSettings(): Promise<SettingsMap> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const result = { ...SETTINGS_DEFAULTS };
  for (const key of Object.keys(SETTINGS_DEFAULTS) as SettingKey[]) {
    if (!stored.has(key)) continue;
    const parsed = await parseSettingValueSafely(key, stored.get(key));
    if (parsed !== undefined) {
      (result as Record<SettingKey, unknown>)[key] = parsed;
    }
  }
  return result;
}

/**
 * Partial-updates the settings map: validates + writes each `[key, value]`
 * pair in `patch` (throwing on the FIRST invalid entry, before any write —
 * see below), then returns the full, freshly-merged map via `getAllSettings`.
 * Mirrors the PATCH route's "partial body, Zod-validated, whitelist
 * response" contract at the core layer.
 *
 * Validates every entry in `patch` up front, before writing any of them —
 * so a request that first sets `theme` then fails on an invalid
 * `trashPurgeDays` doesn't leave a half-applied write (a caller can retry
 * the whole PATCH atomically-in-effect rather than reasoning about which
 * fields landed). Unknown keys are rejected via `isSettingKey`.
 *
 * ACTUALLY atomic, not just "validated up front": every key's write runs
 * inside ONE `db.transaction` (review fix, ce-correctness — an earlier
 * version looped separate un-transacted `setSetting` calls, so a multi-key
 * patch that validated cleanly could still end up PARTIALLY persisted if the
 * database connection dropped between two of the writes). A transaction
 * failure now rolls every key in this patch back together; a caller either
 * sees the whole patch land or none of it.
 */
export async function updateSettings(patch: Record<string, unknown>): Promise<SettingsMap> {
  const entries = Object.entries(patch);
  for (const [key] of entries) {
    if (!isSettingKey(key)) {
      throw new Error(`Unknown settings key: ${key}`);
    }
  }
  // Validate every value against its schema before writing any of them.
  const validated = entries.map(([key, value]) => {
    const settingKey = key as SettingKey;
    return [settingKey, parseSettingValue(settingKey, value)] as const;
  });

  await db.transaction(async (tx) => {
    for (const [key, value] of validated) {
      await setSetting(key, value, tx);
    }
  });

  return getAllSettings();
}

async function validateProviderSelection(
  ai: SettingValue<'ai'>,
  executor: Executor,
): Promise<void> {
  const selections = Object.entries(ai.features).filter(([, f]) => f.model !== null);
  if (!selections.length) return;
  // Lock in provider order to prevent deadlocks between multi-feature writes.
  const rows = await executor
    .select({ kind: aiProviders.kind, models: aiProviders.models })
    .from(aiProviders)
    .where(
      inArray(
        aiProviders.kind,
        selections.flatMap(([, f]) => (f.model ? [f.model.provider] : [])),
      ),
    )
    .orderBy(aiProviders.kind)
    .for('share');
  const byKind = new Map(rows.map((row) => [row.kind, parseStoredModels(row.kind, row.models)]));
  z.unknown()
    .superRefine((_value, ctx) => {
      for (const [id, feature] of selections) {
        const model = feature.model;
        if (model && !(byKind.get(model.provider) ?? []).some((m) => m.id === model.id)) {
          ctx.addIssue({
            code: 'custom',
            message: 'model is not in the stored provider list',
            path: ['features', id, 'model'],
          });
        }
      }
    })
    .parse(ai);
}

/** Internal readiness read retains the selection so an unloaded list gets its own reason. */
export async function getAiSettingForStatus(): Promise<SettingValue<'ai'>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'ai')).limit(1);
  return row
    ? ((await parseSettingValueSafely('ai', row.value, db, false)) ?? SETTINGS_DEFAULTS.ai)
    : SETTINGS_DEFAULTS.ai;
}
