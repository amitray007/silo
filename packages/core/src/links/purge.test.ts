import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';
import type * as PurgeOps from './purge.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md):
 * bounded batching, the FK cascade onto `link_tags`, and the partial-unique
 * slot being freed after purge are all database-level behaviors mocks can't
 * prove.
 *
 * See `../test-support/pg-harness.ts` for why the module(s) under test are
 * loaded via a dynamic `import()` inside the harness's `beforeAll`.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('purgeTrash (integration)', () => {
  const harness = setupPgHarness('silo_core_purge_test', async () => ({
    links: await import('./links.js'),
    purge: await import('./purge.js'),
  }));
  let linksOps: typeof LinksOps;
  let purgeOps: typeof PurgeOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    linksOps = harness.mod().links;
    purgeOps = harness.mod().purge;
    rawDb = harness.rawDb();
  });

  /** Inserts a trashed link directly at the db level with a specific `deleted_at`, bypassing softDelete's `now()`. */
  async function insertTrashedLink(canonicalUrl: string, deletedAt: Date): Promise<{ id: string }> {
    const rows = await rawDb.execute<{ id: string }>(sql`
      insert into links (url, canonical_url, source_kind, deleted_at)
      values (${canonicalUrl}, ${canonicalUrl}, 'link', ${deletedAt.toISOString()}::timestamptz)
      returning id
    `);
    const row = rows.rows[0];
    if (!row) throw new Error('setup: expected an inserted row');
    return row;
  }

  async function totalCount(): Promise<number> {
    const rows = await rawDb.execute<{ count: string }>(sql`select count(*) from links`);
    return Number(rows.rows[0]?.count ?? '0');
  }

  async function linkTagsCountFor(linkId: string): Promise<number> {
    const rows = await rawDb.execute<{ count: string }>(
      sql`select count(*) from link_tags where link_id = ${linkId}`,
    );
    return Number(rows.rows[0]?.count ?? '0');
  }

  const DAY_MS = 24 * 60 * 60 * 1000;

  describe('happy path', () => {
    it('deletes a trashed link older than the window; a newer trashed link survives; a live link is untouched', async () => {
      const old = await insertTrashedLink(
        'https://example.com/old-trash',
        new Date(Date.now() - 40 * DAY_MS),
      );
      const recent = await insertTrashedLink(
        'https://example.com/recent-trash',
        new Date(Date.now() - 1 * DAY_MS),
      );
      const live = await linksOps.createLink({
        url: 'https://example.com/still-live',
        sourceKind: 'link',
      });

      const purged = await purgeOps.purgeTrash({ olderThanDays: 30 });

      expect(purged).toBe(1);
      expect(await linksOps.getById(old.id)).toBeNull();
      const rows = await rawDb.execute<{ id: string }>(sql`select id from links`);
      const remainingIds = rows.rows.map((r) => r.id);
      expect(remainingIds).not.toContain(old.id);
      expect(remainingIds).toContain(recent.id);
      expect(remainingIds).toContain(live.id);
    });
  });

  describe('edge cases', () => {
    it('purges 0 rows from an empty trash without error', async () => {
      const purged = await purgeOps.purgeTrash();
      expect(purged).toBe(0);
    });

    it('batchSize smaller than the backlog still purges everything across iterations', async () => {
      const inserted: string[] = [];
      for (let i = 0; i < 5; i++) {
        const row = await insertTrashedLink(
          `https://example.com/batch-${i}`,
          new Date(Date.now() - 40 * DAY_MS),
        );
        inserted.push(row.id);
      }

      const purged = await purgeOps.purgeTrash({ olderThanDays: 30, batchSize: 2 });

      expect(purged).toBe(5);
      expect(await totalCount()).toBe(0);
    });

    it('rejects a negative olderThanDays', async () => {
      await expect(purgeOps.purgeTrash({ olderThanDays: -1 })).rejects.toThrow();
    });

    it('rejects a non-positive batchSize', async () => {
      await expect(purgeOps.purgeTrash({ batchSize: 0 })).rejects.toThrow();
    });
  });

  describe('FK cascade onto link_tags', () => {
    it('deleting a trashed link with tags cascades its link_tags rows', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/cascade-me',
        tags: ['cascade-a', 'cascade-b'],
        sourceKind: 'link',
      });
      expect(await linkTagsCountFor(created.id)).toBe(2);

      await rawDb.execute(
        sql`update links set deleted_at = ${new Date(Date.now() - 40 * DAY_MS).toISOString()}::timestamptz where id = ${created.id}`,
      );

      const purged = await purgeOps.purgeTrash({ olderThanDays: 30 });

      expect(purged).toBe(1);
      // link_tags rows removed via ON DELETE CASCADE — never deleted manually.
      expect(await linkTagsCountFor(created.id)).toBe(0);
      const tagRows = await rawDb.execute<{ count: string }>(
        sql`select count(*) from tags where name in ('cascade-a', 'cascade-b')`,
      );
      // Tag rows themselves are untouched — only the join rows cascade.
      expect(tagRows.rows[0]?.count).toBe('2');
    });
  });

  describe('canonical_url slot release', () => {
    it('after purge frees a canonical_url, that url can be saved fresh via createLink', async () => {
      const canonicalUrl = 'https://example.com/freed-slot';
      const trashed = await insertTrashedLink(canonicalUrl, new Date(Date.now() - 40 * DAY_MS));

      const purged = await purgeOps.purgeTrash({ olderThanDays: 30 });
      expect(purged).toBe(1);

      const fresh = await linksOps.createLink({
        url: canonicalUrl,
        title: 'Freshly saved',
        sourceKind: 'link',
      });

      expect(fresh.id).not.toBe(trashed.id);
      expect(fresh.canonicalUrl).toBe(canonicalUrl);
      expect(fresh.deletedAt).toBeNull();
      expect(fresh.title).toBe('Freshly saved');
    });
  });

  describe('restore-merge leftover reaping', () => {
    it('purge reaps the trashed row left behind by a restore-merge once it ages out, without touching the live row', async () => {
      // Reproduce the restore-merge collision from links.test.ts: a trashed
      // original + a live replacement sharing one canonical_url. Restoring
      // the original folds its data into the live row and leaves the
      // trashed original behind (documented in links.ts `restore`). Once
      // that leftover ages past the window, purge must reap it — and must
      // never touch the live row it was merged into.
      const original = await linksOps.createLink({
        url: 'https://example.com/restore-leftover',
        notes: 'original notes',
        tags: ['leftover-tag'],
        sourceKind: 'link',
      });
      await linksOps.softDelete(original.id);

      const replacementRows = await rawDb.execute<{ id: string }>(sql`
        insert into links (url, canonical_url, source_kind, notes)
        values ('https://example.com/restore-leftover', 'https://example.com/restore-leftover', 'link', 'replacement notes')
        returning id
      `);
      const liveReplacement = replacementRows.rows[0];
      if (!liveReplacement) throw new Error('setup: expected a live replacement row');

      const result = await linksOps.restore(original.id);
      expect(result.status).toBe('merged');
      if (result.status !== 'merged') throw new Error('expected merged');
      expect(result.link.id).toBe(liveReplacement.id);

      // The original trashed row is still present (left behind by the merge).
      const trashedRowsBefore = await rawDb.execute<{ id: string; deleted_at: string | null }>(
        sql`select id, deleted_at from links where id = ${original.id}`,
      );
      expect(trashedRowsBefore.rows).toHaveLength(1);
      expect(trashedRowsBefore.rows[0]?.deleted_at).not.toBeNull();

      // Age it out of the window.
      await rawDb.execute(
        sql`update links set deleted_at = ${new Date(Date.now() - 40 * DAY_MS).toISOString()}::timestamptz where id = ${original.id}`,
      );

      const purged = await purgeOps.purgeTrash({ olderThanDays: 30 });
      expect(purged).toBe(1);

      const originalRowsAfter = await rawDb.execute<{ id: string }>(
        sql`select id from links where id = ${original.id}`,
      );
      expect(originalRowsAfter.rows).toHaveLength(0);

      // The live row it was merged into is untouched.
      const liveAfter = await linksOps.getById(liveReplacement.id);
      expect(liveAfter).not.toBeNull();
      expect(liveAfter?.notes).toContain('replacement notes');
      expect(liveAfter?.notes).toContain('original notes');
    });
  });

  describe('restore-vs-purge safety', () => {
    it('sequential: a restored row (deleted_at -> NULL) is never purged', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/restored-not-purged',
        sourceKind: 'link',
      });
      await rawDb.execute(
        sql`update links set deleted_at = now() - make_interval(days => 90) where id = ${created.id}`,
      );
      const restored = await linksOps.restore(created.id);
      expect(restored.status).toBe('restored');

      const purged = await purgeOps.purgeTrash({ olderThanDays: 30 });
      expect(purged).toBe(0);
      const survivor = await linksOps.getById(created.id);
      expect(survivor?.deletedAt).toBeNull();
    });

    it('CONCURRENT: a restore committing mid-purge does not lose the live row', async () => {
      // The load-bearing safety test. A restore commits WHILE the purge DELETE
      // is blocked on the row lock (after the DELETE's subquery scanned the row
      // but before it deletes). This distinguishes the safe outer-guard form
      // from the unsafe subquery-only form: without the predicate in the outer
      // WHERE, EvalPlanQual re-checks only `id IN (...)` (still true) and purges
      // the now-live row. With it, EPQ re-checks deleted_at and drops the row.
      const created = await linksOps.createLink({
        url: 'https://example.com/concurrent-restore',
        sourceKind: 'link',
      });
      await rawDb.execute(
        sql`update links set deleted_at = now() - make_interval(days => 90) where id = ${created.id}`,
      );

      // Connection A: restore inside a transaction, holding the row lock so
      // the purge blocks after its subquery has already scanned the row.
      const restoreClient = new Client({ connectionString: harness.databaseUrl() });
      await restoreClient.connect();
      try {
        await restoreClient.query('begin');
        await restoreClient.query('update links set deleted_at = null where id = $1', [created.id]);

        // Kick off the REAL purgeTrash (runs on @silo/db's own pool) — it blocks
        // on A's row lock. Calling the actual code under test is what makes this
        // a regression guard: it exercises purge.ts's query, so removing the
        // outer-WHERE guard makes this test fail.
        const purgePromise = purgeOps.purgeTrash({ olderThanDays: 30 });

        // Let purge reach the lock wait, then commit the restore.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await restoreClient.query('commit');
        const purged = await purgePromise;

        // The purge must have deleted nothing — the row was restored to live.
        expect(purged).toBe(0);
        const survivor = await linksOps.getById(created.id);
        expect(survivor).not.toBeNull();
        expect(survivor?.deletedAt).toBeNull();
      } finally {
        await restoreClient.end();
      }
    });
  });

  describe('input validation', () => {
    it('rejects a non-integer olderThanDays with a clean error (not a raw pg 22P02)', async () => {
      await expect(purgeOps.purgeTrash({ olderThanDays: 7.5 })).rejects.toThrow(
        /olderThanDays must be a non-negative integer/,
      );
    });
  });
});
