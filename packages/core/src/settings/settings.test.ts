import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as SettingsOps from './settings.js';

/**
 * Integration tests for the settings store (plan 016) against a real
 * Postgres (see docs/rules/testing.md — the upsert/jsonb-validation
 * behaviors here are worth proving against the real driver, not a mock).
 *
 * `setupPgHarness`'s shared `afterEach` only truncates
 * `link_tags`/`links`/`tags` (see `pg-harness.ts`) — this suite adds its own
 * `settings`-table truncate on top, since it's the only suite touching that
 * table.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('settings store (integration, plan 016)', () => {
  const harness = setupPgHarness('silo_core_settings_test', async () => {
    return (await import('./settings.js')) as typeof SettingsOps;
  });
  let ops: typeof SettingsOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    ops = harness.mod();
    rawDb = harness.rawDb();
    await rawDb.execute(sql`TRUNCATE TABLE settings`);
  });

  describe('defaults (fresh/unset)', () => {
    it('getSetting returns the default for every known key when unset', async () => {
      expect(await ops.getSetting('theme')).toBe('system');
      expect(await ops.getSetting('trashPurgeDays')).toBe(30);
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: true,
        github: true,
        youtube: true,
      });
    });

    it('getAllSettings returns every allowlisted key with its default in a fresh database', async () => {
      const all = await ops.getAllSettings();
      expect(all).toEqual({
        theme: 'system',
        trashPurgeDays: 30,
        plugins: { hacker_news: true, github: true, youtube: true },
      });
    });
  });

  describe('setSetting / getSetting round-trip', () => {
    it('persists a valid theme and reads it back', async () => {
      await ops.setSetting('theme', 'dark');
      expect(await ops.getSetting('theme')).toBe('dark');
    });

    it('persists a valid trashPurgeDays and reads it back', async () => {
      await ops.setSetting('trashPurgeDays', 7);
      expect(await ops.getSetting('trashPurgeDays')).toBe(7);
    });

    it('persists a partial plugins record merge — the FULL object is stored, not merged at write time', async () => {
      await ops.setSetting('plugins', { hacker_news: false, github: true, youtube: false });
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: false,
        github: true,
        youtube: false,
      });
    });

    it('upserts idempotently — writing the same key twice never throws a unique-violation', async () => {
      await ops.setSetting('theme', 'light');
      await expect(ops.setSetting('theme', 'dark')).resolves.not.toThrow();
      expect(await ops.getSetting('theme')).toBe('dark');
    });

    it('rejects an invalid theme value', async () => {
      await expect(ops.setSetting('theme', 'blue')).rejects.toThrow();
    });

    it('getSetting falls back to the default (not an uncaught throw) when the stored value is corrupted', async () => {
      // Regression test (review fix, ce-correctness): getSetting previously
      // called the THROWING parseSettingValue directly, so a hand-edited/
      // corrupted row would throw uncaught out of getSetting instead of
      // degrading to the default — disagreeing with getAllSettings, which
      // already fell back gracefully for the identical condition (see the
      // "hand-corrupted stored value" test in the getAllSettings describe
      // block below). getSetting must behave the same way.
      await rawDb.execute(
        sql`insert into settings (key, value) values ('theme', '"not-a-real-theme"'::jsonb)`,
      );
      await expect(ops.getSetting('theme')).resolves.toBe('system');
    });

    it('rejects an invalid trashPurgeDays value (not in the 7|30|90 allowlist)', async () => {
      await expect(ops.setSetting('trashPurgeDays', 5)).rejects.toThrow();
    });

    it('rejects a plugins record with an unknown plugin key (.strict())', async () => {
      await expect(
        ops.setSetting('plugins', { hacker_news: true, github: true, youtube: true, evil: true }),
      ).rejects.toThrow();
    });

    it('rejects a plugins record missing a known key', async () => {
      await expect(
        ops.setSetting('plugins', { hacker_news: true, github: true }),
      ).rejects.toThrow();
    });

    it('never writes to the database when validation fails', async () => {
      await expect(ops.setSetting('theme', 'blue')).rejects.toThrow();
      // theme still falls back to its default — nothing was written.
      expect(await ops.getSetting('theme')).toBe('system');
    });
  });

  describe('getAllSettings — partial state', () => {
    it('mixes stored values with defaults for keys never written', async () => {
      await ops.setSetting('theme', 'dark');
      const all = await ops.getAllSettings();
      expect(all).toEqual({
        theme: 'dark',
        trashPurgeDays: 30,
        plugins: { hacker_news: true, github: true, youtube: true },
      });
    });

    it('a hand-corrupted stored value for one key falls back to its default without failing the whole read', async () => {
      // Simulate a value that no longer validates (e.g. a schema tightened
      // after this row was written) by writing raw invalid JSON directly,
      // bypassing setSetting's validation.
      await rawDb.execute(
        sql`insert into settings (key, value) values ('theme', '"not-a-real-theme"'::jsonb)`,
      );
      await ops.setSetting('trashPurgeDays', 90);

      const all = await ops.getAllSettings();
      expect(all.theme).toBe('system'); // fell back to default
      expect(all.trashPurgeDays).toBe(90); // unaffected
    });
  });

  describe('updateSettings — partial PATCH merge semantics', () => {
    it('applies a partial patch, returning the full merged map', async () => {
      await ops.setSetting('theme', 'dark');
      const result = await ops.updateSettings({ trashPurgeDays: 7 });
      expect(result).toEqual({
        theme: 'dark',
        trashPurgeDays: 7,
        plugins: { hacker_news: true, github: true, youtube: true },
      });
    });

    it('an empty patch is a no-op that still returns the current full map', async () => {
      await ops.setSetting('theme', 'light');
      const result = await ops.updateSettings({});
      expect(result.theme).toBe('light');
    });

    it('rejects an unknown key in the patch and writes NOTHING from that patch', async () => {
      await ops.setSetting('theme', 'light');
      await expect(ops.updateSettings({ theme: 'dark', notAKey: true })).rejects.toThrow();
      // theme must remain 'light' — the whole patch was rejected up front,
      // before any key in it was written.
      expect(await ops.getSetting('theme')).toBe('light');
    });

    it('rejects an invalid value for a known key and writes NOTHING from that patch', async () => {
      await ops.setSetting('trashPurgeDays', 30);
      await expect(ops.updateSettings({ trashPurgeDays: 5, theme: 'dark' })).rejects.toThrow();
      // Neither field should have been written — validated up front.
      expect(await ops.getSetting('trashPurgeDays')).toBe(30);
      expect(await ops.getSetting('theme')).toBe('system');
    });

    it('multiple keys in one patch all persist together', async () => {
      const result = await ops.updateSettings({
        theme: 'dark',
        trashPurgeDays: 90,
        plugins: { hacker_news: false, github: false, youtube: false },
      });
      expect(result).toEqual({
        theme: 'dark',
        trashPurgeDays: 90,
        plugins: { hacker_news: false, github: false, youtube: false },
      });
      // And it's actually persisted, not just returned.
      expect(await ops.getSetting('theme')).toBe('dark');
    });
  });
});
