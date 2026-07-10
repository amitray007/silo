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
      expect(await ops.getSetting('mcpAccess')).toBe(true);
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
      });
    });

    it('getAllSettings returns every allowlisted key with its default in a fresh database', async () => {
      const all = await ops.getAllSettings();
      expect(all).toEqual({
        theme: 'system',
        trashPurgeDays: 30,
        mcpAccess: true,
        linkPreviewImages: true,
        plugins: {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, inline: true, hover: true },
        },
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

    it('persists a valid mcpAccess and reads it back', async () => {
      await ops.setSetting('mcpAccess', false);
      expect(await ops.getSetting('mcpAccess')).toBe(false);
    });

    it('rejects an invalid mcpAccess value (non-boolean)', async () => {
      await expect(ops.setSetting('mcpAccess', 'yes')).rejects.toThrow();
    });

    it('persists a partial plugins record merge — the FULL object is stored, not merged at write time', async () => {
      await ops.setSetting('plugins', {
        hacker_news: { enabled: false, inline: false, hover: false },
        github: { enabled: true, hover: true },
        youtube: { enabled: false, hover: false },
        twitter: { enabled: false, inline: false, hover: false },
      });
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: { enabled: false, inline: false, hover: false },
        github: { enabled: true, hover: true },
        youtube: { enabled: false, hover: false },
        twitter: { enabled: false, inline: false, hover: false },
      });
    });

    it('a legacy boolean-shaped plugins blob (pre-026) reads back migrated to the new per-feature shape', async () => {
      // Simulate a row written before plan 026, bypassing setSetting's
      // CURRENT-schema validation — this is exactly the shape a real
      // pre-026 install has sitting in its `settings` table today.
      await rawDb.execute(
        sql`insert into settings (key, value) values ('plugins', '{"hacker_news": true, "github": false, "youtube": true}'::jsonb)`,
      );
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: false, hover: false },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true }, // filled with default — a legacy blob predates twitter entirely
      });
    });

    it('a pre-plan-026-twitter stored blob (new per-feature shape, but no `twitter` key) reads back with twitter filled to its default', async () => {
      // Simulate a row written after plan 026's plugins redesign but BEFORE
      // this un-parking — hacker_news/github/youtube already in the current
      // per-feature shape, but `twitter` never existed as a settings key yet.
      await rawDb.execute(
        sql`insert into settings (key, value) values ('plugins', '{"hacker_news": {"enabled": true, "inline": true, "hover": true}, "github": {"enabled": true, "hover": true}, "youtube": {"enabled": true, "hover": true}}'::jsonb)`,
      );
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true }, // filled with default
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

    it('rejects a plugins record with an unknown top-level plugin key (.strict())', async () => {
      await expect(
        ops.setSetting('plugins', {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, inline: true, hover: true },
          evil: { enabled: true },
        }),
      ).rejects.toThrow();
    });

    it('a plugins record with a stray field on a per-source object is NOT rejected — that source falls back to its default (migration normalizer is lenient per-source by design)', async () => {
      await ops.setSetting('plugins', {
        hacker_news: { enabled: true, inline: true, hover: true, evil: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
      });
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: { enabled: true, inline: true, hover: true }, // fell back to default
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
      });
    });

    it('a plugins record missing a known top-level source key is NOT rejected — the migration fills the missing source with its default (legacy-tolerant read path)', async () => {
      // Pre-026 note: this used to throw (missing key = invalid under the
      // old flat-boolean .strict() schema). Under the plan-026 migration, a
      // missing source is indistinguishable from "not upgraded yet" and
      // gets that source's default instead — see `coerceLegacyPluginSource`.
      await ops.setSetting('plugins', {
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
      });
      expect(await ops.getSetting('plugins')).toEqual({
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true }, // filled with default
        twitter: { enabled: true, inline: true, hover: true }, // filled with default
      });
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
        mcpAccess: true,
        linkPreviewImages: true,
        plugins: {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, inline: true, hover: true },
        },
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
        mcpAccess: true,
        linkPreviewImages: true,
        plugins: {
          hacker_news: { enabled: true, inline: true, hover: true },
          github: { enabled: true, hover: true },
          youtube: { enabled: true, hover: true },
          twitter: { enabled: true, inline: true, hover: true },
        },
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
        mcpAccess: false,
        linkPreviewImages: true,
        plugins: {
          hacker_news: { enabled: false, inline: false, hover: false },
          github: { enabled: false, hover: false },
          youtube: { enabled: false, hover: false },
          twitter: { enabled: false, inline: false, hover: false },
        },
      });
      expect(result).toEqual({
        theme: 'dark',
        trashPurgeDays: 90,
        mcpAccess: false,
        linkPreviewImages: true,
        plugins: {
          hacker_news: { enabled: false, inline: false, hover: false },
          github: { enabled: false, hover: false },
          youtube: { enabled: false, hover: false },
          twitter: { enabled: false, inline: false, hover: false },
        },
      });
      // And it's actually persisted, not just returned.
      expect(await ops.getSetting('theme')).toBe('dark');
      expect(await ops.getSetting('mcpAccess')).toBe(false);
    });
  });
});
