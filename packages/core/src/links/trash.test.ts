import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';
import type * as TrashOps from './trash.js';

/**
 * Integration tests for `listTrash`/counts (plan 007, C2) against a real
 * Postgres (see docs/rules/testing.md) — keyset pagination across the
 * `deleted_at` column, live/trash exclusivity, and count correctness are all
 * database-level behaviors mocks can't prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('trash reads + counts (integration, C2)', () => {
  const harness = setupPgHarness('silo_core_trash_test', async () => {
    const links = await import('./links.js');
    const trash = await import('./trash.js');
    return { ...links, ...trash };
  });
  let ops: typeof LinksOps & typeof TrashOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    ops = harness.mod();
    rawDb = harness.rawDb();
  });

  /** Set `deleted_at` for the given link id to an exact raw timestamptz literal (e.g. to force a microsecond-precision tie). */
  async function forceDeletedAt(id: string, deletedAt: string): Promise<void> {
    await rawDb.execute(
      sql`update links set deleted_at = ${deletedAt}::timestamptz where id = ${id}`,
    );
  }

  /** Create + immediately softDelete `count` fresh links under `urlPrefix`, returning their ids in creation order. */
  async function seedTrashed(urlPrefix: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const link = await ops.createLink({ url: `${urlPrefix}-${i}`, sourceKind: 'link' });
      await ops.softDelete(link.id);
      ids.push(link.id);
    }
    return ids;
  }

  /** Walk every `listTrash()` page via `nextCursor` (small limit, guarded against an infinite loop) and return every trashed link id seen, in page order. */
  async function walkAllTrashPages(limit = 2): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const { links: page, nextCursor } = await ops.listTrash(
        cursor === undefined ? { limit } : { limit, cursor },
      );
      seen.push(...page.map((l) => l.id));
      cursor = nextCursor;
      guard++;
    } while (cursor !== undefined && guard < 20);
    return seen;
  }

  /** Walk every trash page (default limit) and assert every id in `expectedIds` was seen exactly once — no dup, no gap. */
  async function expectWalkSeesExactlyOnce(
    expectedIds: ReadonlyArray<string>,
    limit?: number,
  ): Promise<void> {
    const seen = await walkAllTrashPages(limit);
    expect(seen.sort()).toEqual([...expectedIds].sort());
    expect(new Set(seen).size).toBe(seen.length);
  }

  describe('listTrash — live/trash exclusivity', () => {
    it('a trashed link appears in listTrash and NOT in list(); a live link is the reverse', async () => {
      const live = await ops.createLink({
        url: 'https://example.com/trash-exclusivity-live',
        sourceKind: 'link',
      });
      const trashed = await ops.createLink({
        url: 'https://example.com/trash-exclusivity-trashed',
        sourceKind: 'link',
      });
      await ops.softDelete(trashed.id);

      const { links: livePage } = await ops.list();
      expect(livePage.map((l) => l.id)).toContain(live.id);
      expect(livePage.map((l) => l.id)).not.toContain(trashed.id);

      const { links: trashPage } = await ops.listTrash();
      expect(trashPage.map((l) => l.id)).toContain(trashed.id);
      expect(trashPage.map((l) => l.id)).not.toContain(live.id);
    });

    it('listTrash rows carry a non-null deletedAt and hydrated tags', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/trash-shape',
        tags: ['trashed-tag'],
        sourceKind: 'link',
      });
      await ops.softDelete(created.id);

      const { links: page } = await ops.listTrash();
      const row = page.find((l) => l.id === created.id);
      expect(row).toBeDefined();
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.tags).toEqual(['trashed-tag']);
    });
  });

  describe('listTrash — ordering', () => {
    it('orders newest-trashed-first', async () => {
      const first = await ops.createLink({
        url: 'https://example.com/trash-order-1',
        sourceKind: 'link',
      });
      const second = await ops.createLink({
        url: 'https://example.com/trash-order-2',
        sourceKind: 'link',
      });
      const third = await ops.createLink({
        url: 'https://example.com/trash-order-3',
        sourceKind: 'link',
      });

      // Trash them in order with distinct deleted_at values so ordering is
      // unambiguous (softDelete uses `new Date()`, which could tie at ms
      // resolution under fast test execution).
      await ops.softDelete(first.id);
      await forceDeletedAt(first.id, '2026-01-01 00:00:00.000001+00');
      await ops.softDelete(second.id);
      await forceDeletedAt(second.id, '2026-01-01 00:00:00.000002+00');
      await ops.softDelete(third.id);
      await forceDeletedAt(third.id, '2026-01-01 00:00:00.000003+00');

      const { links: page } = await ops.listTrash();
      const ids = page.map((l) => l.id);
      expect(ids.indexOf(third.id)).toBeLessThan(ids.indexOf(second.id));
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    });
  });

  describe('listTrash — pagination', () => {
    it('walks every trashed link exactly once across pages (no dup/gap)', async () => {
      const ids = await seedTrashed('https://example.com/trash-page', 7);

      await expectWalkSeesExactlyOnce(ids, 2);
    });

    it('tied-deleted_at case: rows sharing an IDENTICAL microsecond-precision deleted_at are never dropped', async () => {
      // The exact bug class `list()`'s keyset had (see links.ts's
      // afterListCursor doc comment): if the cursor's deleted_at were
      // ms-truncated while the ORDER BY sorts on the raw µs column, rows
      // tied at µs precision would silently drop across a page boundary.
      const ids = await seedTrashed('https://example.com/trash-tied', 5);
      for (const id of ids) {
        await forceDeletedAt(id, '2026-02-02 08:00:00.222222+00');
      }

      await expectWalkSeesExactlyOnce(ids, 2);
    });

    it('mixed: some rows tied on deleted_at, some distinct, all walk exactly once', async () => {
      const tiedIds = await seedTrashed('https://example.com/trash-mixed-tied', 3);
      for (const id of tiedIds) {
        await forceDeletedAt(id, '2026-03-03 09:30:00.333333+00');
      }

      const distinctIds = await seedTrashed('https://example.com/trash-mixed-distinct', 3);

      await expectWalkSeesExactlyOnce([...tiedIds, ...distinctIds]);
    });

    it('empty trash has no nextCursor', async () => {
      const { links: page, nextCursor } = await ops.listTrash();
      expect(page).toEqual([]);
      expect(nextCursor).toBeUndefined();
    });
  });

  describe('listTrash — cursor kind isolation', () => {
    it('a list cursor fed to listTrash throws InvalidCursorError', async () => {
      await ops.createLink({ url: 'https://example.com/trash-cursor-a', sourceKind: 'link' });
      await ops.createLink({ url: 'https://example.com/trash-cursor-b', sourceKind: 'link' });

      const { nextCursor } = await ops.list({}, { limit: 1 });
      expect(nextCursor).toBeDefined();

      await expect(ops.listTrash({ cursor: nextCursor as string })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('a trash cursor fed to list() throws InvalidCursorError', async () => {
      await seedTrashed('https://example.com/trash-cursor-list', 2);

      const { nextCursor } = await ops.listTrash({ limit: 1 });
      expect(nextCursor).toBeDefined();

      await expect(ops.list({}, { cursor: nextCursor as string })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('a trash cursor fed to search() throws InvalidCursorError', async () => {
      for (const suffix of ['1', '2']) {
        const link = await ops.createLink({
          url: `https://example.com/trash-cursor-search-${suffix}`,
          title: 'trashcursorsearchterm',
          sourceKind: 'link',
        });
        await ops.softDelete(link.id);
      }

      const trashCursor = (await ops.listTrash({ limit: 1 })).nextCursor;
      expect(trashCursor).toBeDefined();

      const searchWithTrashCursor = ops.search('anything', { cursor: trashCursor as string });
      await expect(searchWithTrashCursor).rejects.toThrow(ops.InvalidCursorError);
    });

    it('a malformed cursor throws InvalidCursorError', async () => {
      await expect(ops.listTrash({ cursor: 'not-valid-base64json' })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });
  });

  describe('counts', () => {
    it('countLive/countTrash/getCounts are correct as links are created', async () => {
      const before = await ops.getCounts();

      await ops.createLink({ url: 'https://example.com/count-live-1', sourceKind: 'link' });
      await ops.createLink({ url: 'https://example.com/count-live-2', sourceKind: 'link' });

      expect(await ops.countLive()).toBe(before.live + 2);
      expect(await ops.countTrash()).toBe(before.trash);
      expect(await ops.getCounts()).toEqual({ live: before.live + 2, trash: before.trash });
    });

    it('counts update as links are softDeleted (moved live -> trash)', async () => {
      const link = await ops.createLink({
        url: 'https://example.com/count-softdelete',
        sourceKind: 'link',
      });
      const before = await ops.getCounts();

      await ops.softDelete(link.id);

      expect(await ops.getCounts()).toEqual({ live: before.live - 1, trash: before.trash + 1 });
    });

    it('counts update as a trashed link is restored (moved trash -> live)', async () => {
      const link = await ops.createLink({
        url: 'https://example.com/count-restore',
        sourceKind: 'link',
      });
      await ops.softDelete(link.id);
      const before = await ops.getCounts();

      const result = await ops.restore(link.id);
      expect(result.status).toBe('restored');

      expect(await ops.getCounts()).toEqual({ live: before.live + 1, trash: before.trash - 1 });
    });

    it('getCounts matches the sum of individual countLive/countTrash calls', async () => {
      await ops.createLink({ url: 'https://example.com/count-combined-1', sourceKind: 'link' });
      const trashedLink = await ops.createLink({
        url: 'https://example.com/count-combined-2',
        sourceKind: 'link',
      });
      await ops.softDelete(trashedLink.id);

      const [live, trash, combined] = await Promise.all([
        ops.countLive(),
        ops.countTrash(),
        ops.getCounts(),
      ]);

      expect(combined).toEqual({ live, trash });
    });
  });
});
