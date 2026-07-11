import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as BulkOps from './bulk.js';
import type * as EnrichmentOps from './enrichment.js';
import type * as LinksOps from './links.js';

/**
 * Integration tests for the bulk write/batch-read ops (agent-navigation slice
 * U3) against a real Postgres (see docs/rules/testing.md) — partial-failure
 * isolation across sequential DB calls, tag m2m state, and trash/restore
 * transitions are database-level behaviors mocks can't prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('bulk write + batch-read ops (integration, U3)', () => {
  const harness = setupPgHarness('silo_core_bulk_test', async () => {
    const links = await import('./links.js');
    const enrichment = await import('./enrichment.js');
    const bulk = await import('./bulk.js');
    return { ...links, ...enrichment, ...bulk };
  });
  let ops: typeof LinksOps & typeof EnrichmentOps & typeof BulkOps;

  beforeEach(() => {
    ops = harness.mod();
  });

  /** Create `count` fresh links under `urlPrefix`, returning their ids in creation order. */
  async function seedLinks(urlPrefix: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const link = await ops.createLink({ url: `${urlPrefix}-${i}`, sourceKind: 'link' });
      ids.push(link.id);
    }
    return ids;
  }

  const NONEXISTENT_ID = '00000000-0000-4000-8000-000000000000';

  describe('addTagMany / removeTagMany', () => {
    it('all-succeed: tags every id', async () => {
      const ids = await seedLinks('https://example.com/bulk-tag-all', 3);
      const results = await ops.addTagMany(ids, 'batch-tag');

      expect(results).toEqual(ids.map((id) => ({ id, ok: true })));

      for (const id of ids) {
        const link = await ops.getById(id);
        expect(link?.tags).toContain('batch-tag');
      }
    });

    it('mixed good+bad ids: applies the good ones, reports ok:false for a nonexistent id (addTag throws on the FK)', async () => {
      const [goodId] = await seedLinks('https://example.com/bulk-tag-mixed', 1);
      if (!goodId) throw new Error('seed failed');

      const results = await ops.addTagMany([goodId, NONEXISTENT_ID], 'mixed-tag');

      // addTag succeeds for the real id but THROWS for a genuinely
      // nonexistent linkId (link_tags' FK to links) — the batch still
      // applies the good one, and the bad one is reported ok:false rather
      // than aborting the rest.
      expect(results[0]).toEqual({ id: goodId, ok: true });
      expect(results[1]?.id).toBe(NONEXISTENT_ID);
      expect(results[1]?.ok).toBe(false);
      const link = await ops.getById(goodId);
      expect(link?.tags).toContain('mixed-tag');
    });

    it('mixed good+bad ids for removeTagMany: an unknown linkId is a harmless no-op (ok:true), unlike addTagMany', async () => {
      const [goodId] = await seedLinks('https://example.com/bulk-untag-mixed', 1);
      if (!goodId) throw new Error('seed failed');
      await ops.addTag(goodId, 'mixed-untag');

      const results = await ops.removeTagMany([goodId, NONEXISTENT_ID], 'mixed-untag');

      expect(results).toEqual([
        { id: goodId, ok: true },
        { id: NONEXISTENT_ID, ok: true },
      ]);
      const link = await ops.getById(goodId);
      expect(link?.tags).not.toContain('mixed-untag');
    });

    it('empty array returns empty result, no error', async () => {
      await expect(ops.addTagMany([], 'x')).resolves.toEqual([]);
      await expect(ops.removeTagMany([], 'x')).resolves.toEqual([]);
    });

    it('over-cap throws the clear error', async () => {
      const tooMany = Array.from({ length: ops.MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
      await expect(ops.addTagMany(tooMany, 'x')).rejects.toThrow(ops.TooManyIdsError);
      await expect(ops.removeTagMany(tooMany, 'x')).rejects.toThrow(ops.TooManyIdsError);
    });

    it('removeTagMany: all-succeed removes the tag from every id that had it', async () => {
      const ids = await seedLinks('https://example.com/bulk-untag', 2);
      await ops.addTagMany(ids, 'to-remove');

      const results = await ops.removeTagMany(ids, 'to-remove');
      expect(results).toEqual(ids.map((id) => ({ id, ok: true })));

      for (const id of ids) {
        const link = await ops.getById(id);
        expect(link?.tags).not.toContain('to-remove');
      }
    });
  });

  describe('trashMany / restoreMany', () => {
    it('all-succeed: trashes every id', async () => {
      const ids = await seedLinks('https://example.com/bulk-trash-all', 3);
      const results = await ops.trashMany(ids);

      expect(results).toEqual(ids.map((id) => ({ id, ok: true })));
      for (const id of ids) {
        expect(await ops.getById(id)).toBeNull();
      }
    });

    it('mixed good+bad ids (real, nonexistent, already-trashed): correct per-item ok/reason, good ones still trashed', async () => {
      const [freshId, alreadyTrashedId] = await seedLinks(
        'https://example.com/bulk-trash-mixed',
        2,
      );
      if (!freshId || !alreadyTrashedId) throw new Error('seed failed');
      await ops.softDelete(alreadyTrashedId);

      const results = await ops.trashMany([freshId, NONEXISTENT_ID, alreadyTrashedId]);

      expect(results).toEqual([
        { id: freshId, ok: true },
        { id: NONEXISTENT_ID, ok: false, reason: 'not found or already trashed' },
        { id: alreadyTrashedId, ok: false, reason: 'not found or already trashed' },
      ]);
      expect(await ops.getById(freshId)).toBeNull();
    });

    it('empty array returns empty result, no error', async () => {
      await expect(ops.trashMany([])).resolves.toEqual([]);
      await expect(ops.restoreMany([])).resolves.toEqual([]);
    });

    it('over-cap throws the clear error', async () => {
      const tooMany = Array.from({ length: ops.MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
      await expect(ops.trashMany(tooMany)).rejects.toThrow(ops.TooManyIdsError);
      await expect(ops.restoreMany(tooMany)).rejects.toThrow(ops.TooManyIdsError);
    });

    it('restoreMany: all-succeed restores every trashed id; mixed good+bad reports not_found for a live/unknown id', async () => {
      const ids = await seedLinks('https://example.com/bulk-restore', 2);
      for (const id of ids) await ops.softDelete(id);
      const [liveId] = await seedLinks('https://example.com/bulk-restore-live', 1);
      if (!liveId) throw new Error('seed failed');

      const results = await ops.restoreMany([...ids, liveId, NONEXISTENT_ID]);

      const byId = new Map(results.map((r) => [r.id, r]));
      for (const id of ids) {
        expect(byId.get(id)).toEqual({ id, ok: true });
        expect(await ops.getById(id)).not.toBeNull();
      }
      expect(byId.get(liveId)).toEqual({
        id: liveId,
        ok: false,
        reason: 'not found (unknown id, or not currently trashed)',
      });
      expect(byId.get(NONEXISTENT_ID)).toEqual({
        id: NONEXISTENT_ID,
        ok: false,
        reason: 'not found (unknown id, or not currently trashed)',
      });
    });
  });

  describe('retryCaptureMany', () => {
    it('all-succeed: resets every retryable link back to enriching', async () => {
      const ids = await seedLinks('https://example.com/bulk-retry', 2);
      // Fresh links start at captureStatus 'enriching' already (a retryable
      // status per requestRetry's RETRYABLE_STATUSES), so this exercises the
      // real reset path without needing a separate recordEnrichment setup.
      const results = await ops.retryCaptureMany(ids);
      expect(results).toEqual(ids.map((id) => ({ id, ok: true })));
    });

    it('mixed good+bad ids: a fully-captured (status full) link and a nonexistent id both report ok:false', async () => {
      const [retryableId, fullId] = await seedLinks('https://example.com/bulk-retry-mixed', 2);
      if (!retryableId || !fullId) throw new Error('seed failed');
      await ops.recordEnrichment(fullId, { status: 'full', title: 'Done' });

      const results = await ops.retryCaptureMany([retryableId, fullId, NONEXISTENT_ID]);

      const byId = new Map(results.map((r) => [r.id, r]));
      expect(byId.get(retryableId)).toEqual({ id: retryableId, ok: true });
      expect(byId.get(fullId)?.ok).toBe(false);
      expect(byId.get(NONEXISTENT_ID)?.ok).toBe(false);
    });

    it('empty array returns empty result, no error', async () => {
      await expect(ops.retryCaptureMany([])).resolves.toEqual([]);
    });

    it('over-cap throws the clear error', async () => {
      const tooMany = Array.from({ length: ops.MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
      await expect(ops.retryCaptureMany(tooMany)).rejects.toThrow(ops.TooManyIdsError);
    });
  });

  describe('getByIds', () => {
    it('order preserved, hydrated with tags', async () => {
      const ids = await seedLinks('https://example.com/bulk-get-order', 3);
      const [firstId, secondId, thirdId] = ids;
      if (!firstId || !secondId || !thirdId) throw new Error('seed failed');
      await ops.addTag(secondId, 'batch-get-tag');

      const results = await ops.getByIds([thirdId, firstId, secondId]);

      expect(results.map((r) => r.id)).toEqual([thirdId, firstId, secondId]);
      expect(results[0]?.link?.id).toBe(thirdId);
      expect(results[1]?.link?.id).toBe(firstId);
      expect(results[2]?.link?.tags).toEqual(['batch-get-tag']);
    });

    it('missing ids reported as link: null, alongside found ones', async () => {
      const [foundId] = await seedLinks('https://example.com/bulk-get-missing', 1);
      if (!foundId) throw new Error('seed failed');

      const results = await ops.getByIds([foundId, NONEXISTENT_ID]);

      expect(results).toEqual([
        { id: foundId, link: expect.objectContaining({ id: foundId }) },
        { id: NONEXISTENT_ID, link: null },
      ]);
    });

    it('a trashed id reports link: null (getById is live-scoped)', async () => {
      const [id] = await seedLinks('https://example.com/bulk-get-trashed', 1);
      if (!id) throw new Error('seed failed');
      await ops.softDelete(id);

      const results = await ops.getByIds([id]);
      expect(results).toEqual([{ id, link: null }]);
    });

    it('duplicate ids handled: each occurrence returns its own entry', async () => {
      const [id] = await seedLinks('https://example.com/bulk-get-dup', 1);
      if (!id) throw new Error('seed failed');

      const results = await ops.getByIds([id, id]);
      expect(results).toHaveLength(2);
      expect(results[0]?.link?.id).toBe(id);
      expect(results[1]?.link?.id).toBe(id);
    });

    it('empty array returns empty result, no error', async () => {
      await expect(ops.getByIds([])).resolves.toEqual([]);
    });

    it('over-cap throws the clear error', async () => {
      const tooMany = Array.from({ length: ops.MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
      await expect(ops.getByIds(tooMany)).rejects.toThrow(ops.TooManyIdsError);
    });
  });

  describe('captureMany', () => {
    it('all-succeed: creates every link, reporting deduped:false for fresh urls', async () => {
      const results = await ops.captureMany([
        { url: 'https://example.com/bulk-capture-1', sourceKind: 'link' },
        { url: 'https://example.com/bulk-capture-2', sourceKind: 'link' },
      ]);

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.deduped).toBe(false);
          expect(await ops.getById(result.id)).not.toBeNull();
        }
      }
    });

    it('a re-capture of an existing url reports deduped:true and merges rather than duplicating', async () => {
      const url = 'https://example.com/bulk-capture-dedupe';
      const first = await ops.createLink({ url, sourceKind: 'link', notes: 'first' });

      const results = await ops.captureMany([{ url, sourceKind: 'link', notes: 'second' }]);

      expect(results).toEqual([{ url, ok: true, id: first.id, deduped: true }]);
    });

    it('mixed good+bad urls: a structurally-bad sourceData throws per-item and is reported ok:false, good ones still created', async () => {
      const results = await ops.captureMany([
        { url: 'https://example.com/bulk-capture-good', sourceKind: 'link' },
        {
          url: 'https://example.com/bulk-capture-bad',
          sourceKind: 'hacker_news',
          // biome-ignore lint/suspicious/noExplicitAny: intentionally malformed sourceData to trigger createLink's Zod rejection
          sourceData: { kind: 'hacker_news', notAValidField: true } as any,
        },
      ]);

      expect(results[0]?.ok).toBe(true);
      expect(results[1]?.ok).toBe(false);
    });

    it('empty array returns empty result, no error', async () => {
      await expect(ops.captureMany([])).resolves.toEqual([]);
    });

    it('over-cap throws the clear error', async () => {
      const tooMany = Array.from({ length: ops.MAX_BULK_IDS + 1 }, (_, i) => ({
        url: `https://example.com/bulk-capture-cap-${i}`,
        sourceKind: 'link',
      }));
      await expect(ops.captureMany(tooMany)).rejects.toThrow(ops.TooManyIdsError);
    });
  });
});
