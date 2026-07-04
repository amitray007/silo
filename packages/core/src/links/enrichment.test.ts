import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as EnrichmentOps from './enrichment.js';
import type * as LinksOps from './links.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md): the
 * live-scope guard (trashed links must never be touched/resurrected) and the
 * don't-clobber merge on partial results are database-level behaviors mocks
 * can't prove.
 *
 * See `../test-support/pg-harness.ts` for why the module(s) under test are
 * loaded via a dynamic `import()` inside the harness's `beforeAll`.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('enrichment operations (integration)', () => {
  const harness = setupPgHarness('silo_core_enrichment_test', async () => ({
    links: await import('./links.js'),
    enrichment: await import('./enrichment.js'),
  }));
  let linksOps: typeof LinksOps;
  let enrichmentOps: typeof EnrichmentOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    linksOps = harness.mod().links;
    enrichmentOps = harness.mod().enrichment;
    rawDb = harness.rawDb();
  });

  async function isTrashed(id: string): Promise<boolean> {
    const rows = await rawDb.execute<{ deleted_at: string | null }>(
      sql`select deleted_at from links where id = ${id}`,
    );
    return rows.rows[0]?.deleted_at != null;
  }

  describe('recordEnrichment — happy path', () => {
    it('sets all fields + captureStatus=full; getById reflects it; updated_at advances', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-happy',
        sourceKind: 'link',
      });
      expect(created.captureStatus).toBe('enriching');

      // Ensure a measurable clock tick between created_at and updated_at.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        title: 'A Rich Article',
        description: 'A rich description',
        imageUrl: 'https://example.com/img.png',
        siteName: 'Example Site',
        text: 'Lots of readable full text content here.',
        status: 'full',
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('A Rich Article');
      expect(updated?.description).toBe('A rich description');
      expect(updated?.imageUrl).toBe('https://example.com/img.png');
      expect(updated?.siteName).toBe('Example Site');
      expect(updated?.extractedText).toBe('Lots of readable full text content here.');
      expect(updated?.captureStatus).toBe('full');
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(updated?.createdAt.getTime() ?? 0);

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.title).toBe('A Rich Article');
      expect(fetched?.captureStatus).toBe('full');
    });
  });

  describe('recordEnrichment — partial (dont-clobber)', () => {
    it('keeps prior metadata where the new result omits a field', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-partial',
        title: 'Original Title',
        description: 'Original description',
        sourceKind: 'link',
      });

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        // title/description omitted — must NOT clobber the existing values.
        siteName: 'New Site Name',
        status: 'partial',
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('Original Title');
      expect(updated?.description).toBe('Original description');
      expect(updated?.siteName).toBe('New Site Name');
      expect(updated?.captureStatus).toBe('partial');
    });
  });

  describe('recordEnrichment — bare', () => {
    it('sets status without wiping existing metadata', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-bare',
        title: 'Kept Title',
        description: 'Kept description',
        sourceKind: 'link',
      });

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'bare',
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('Kept Title');
      expect(updated?.description).toBe('Kept description');
      expect(updated?.captureStatus).toBe('bare');
    });
  });

  describe('recordEnrichment — trashed no-op', () => {
    it('returns null and does not change/resurrect a trashed link', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-trashed',
        title: 'Pre-trash Title',
        sourceKind: 'link',
      });
      await linksOps.softDelete(created.id);
      expect(await isTrashed(created.id)).toBe(true);

      const result = await enrichmentOps.recordEnrichment(created.id, {
        title: 'Should Not Apply',
        status: 'full',
      });

      expect(result).toBeNull();
      // Still trashed, and untouched.
      expect(await isTrashed(created.id)).toBe(true);
      const rows = await rawDb.execute<{ title: string | null; capture_status: string }>(
        sql`select title, capture_status from links where id = ${created.id}`,
      );
      expect(rows.rows[0]?.title).toBe('Pre-trash Title');
      expect(rows.rows[0]?.capture_status).toBe('enriching');
    });
  });

  describe('recordEnrichment — invalid input', () => {
    it('rejects a bad status enum before write', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-bad-status',
        sourceKind: 'link',
      });

      await expect(
        enrichmentOps.recordEnrichment(created.id, {
          status: 'done' as never,
        }),
      ).rejects.toThrow();

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.captureStatus).toBe('enriching');
    });

    it('rejects an oversized string field before write', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-oversized',
        sourceKind: 'link',
      });

      await expect(
        enrichmentOps.recordEnrichment(created.id, {
          title: 'x'.repeat(2001),
          status: 'full',
        }),
      ).rejects.toThrow();

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.title).toBeNull();
      expect(fetched?.captureStatus).toBe('enriching');
    });
  });

  describe('recordEnrichment — nonexistent', () => {
    it('returns null for a random uuid', async () => {
      const result = await enrichmentOps.recordEnrichment('00000000-0000-0000-0000-000000000000', {
        status: 'full',
      });
      expect(result).toBeNull();
    });
  });

  describe('requestRetry', () => {
    it('sets a partial link back to enriching and returns the link', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/retry-partial',
        sourceKind: 'link',
      });
      await enrichmentOps.recordEnrichment(created.id, { status: 'partial' });

      const retried = await enrichmentOps.requestRetry(created.id);

      expect(retried).not.toBeNull();
      expect(retried?.captureStatus).toBe('enriching');
      const fetched = await linksOps.getById(created.id);
      expect(fetched?.captureStatus).toBe('enriching');
    });

    it('sets a bare link back to enriching and returns the link', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/retry-bare',
        sourceKind: 'link',
      });
      await enrichmentOps.recordEnrichment(created.id, { status: 'bare' });

      const retried = await enrichmentOps.requestRetry(created.id);

      expect(retried).not.toBeNull();
      expect(retried?.captureStatus).toBe('enriching');
    });

    it('returns null for a trashed link and does not resurrect it', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/retry-trashed',
        sourceKind: 'link',
      });
      await enrichmentOps.recordEnrichment(created.id, { status: 'bare' });
      await linksOps.softDelete(created.id);
      expect(await isTrashed(created.id)).toBe(true);

      const result = await enrichmentOps.requestRetry(created.id);

      expect(result).toBeNull();
      expect(await isTrashed(created.id)).toBe(true);
      const rows = await rawDb.execute<{ capture_status: string }>(
        sql`select capture_status from links where id = ${created.id}`,
      );
      expect(rows.rows[0]?.capture_status).toBe('bare');
    });

    it('returns null for a random uuid', async () => {
      const result = await enrichmentOps.requestRetry('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('is a no-op (null) on a full link — a good capture is not downgraded', async () => {
      const link = await linksOps.createLink({
        url: 'https://ex.com/retry-full',
        sourceKind: 'link',
      });
      await enrichmentOps.recordEnrichment(link.id, { status: 'full' });
      const result = await enrichmentOps.requestRetry(link.id);
      expect(result).toBeNull();
      // Status stays full — the retry did not touch it.
      expect((await linksOps.getById(link.id))?.captureStatus).toBe('full');
    });

    it('re-kicks a link stranded at enriching (recovery for a no-worker create)', async () => {
      const link = await linksOps.createLink({
        url: 'https://ex.com/retry-enr',
        sourceKind: 'link',
      });
      // Freshly created links start `enriching`. If no worker ever enqueued the
      // job (no-op enqueuer), the link is stranded there — requestRetry is the
      // recovery path back into the queue, so it returns the link (not null).
      const result = await enrichmentOps.requestRetry(link.id);
      expect(result).not.toBeNull();
      expect(result?.captureStatus).toBe('enriching');
    });
  });

  describe('recordEnrichment — concurrent-edit safety (COALESCE, no lost update)', () => {
    it('does not clobber a field edited after enrichment started (coalesce reads live value)', async () => {
      const link = await linksOps.createLink({
        url: 'https://ex.com/coalesce',
        sourceKind: 'link',
      });
      await enrichmentOps.recordEnrichment(link.id, { title: 'Enriched Title', status: 'full' });
      // A user edits the title; then a later partial enrichment lands WITHOUT a
      // title. Because recordEnrichment is a single UPDATE with COALESCE reading
      // the LIVE column, the user's edit is preserved — not overwritten by a
      // value read before the edit.
      await linksOps.editLink(link.id, { title: 'User Edited Title' });
      const result = await enrichmentOps.recordEnrichment(link.id, {
        description: 'later desc',
        status: 'partial',
      });
      expect(result?.title).toBe('User Edited Title');
      expect(result?.description).toBe('later desc');
    });

    it('leaves a link trashed mid-flight untouched (update whereLive is load-bearing)', async () => {
      const link = await linksOps.createLink({ url: 'https://ex.com/mid', sourceKind: 'link' });
      // Trash it, then attempt to enrich — the single UPDATE's whereLive
      // predicate matches zero rows, so nothing is written and null is returned.
      await linksOps.softDelete(link.id);
      const result = await enrichmentOps.recordEnrichment(link.id, { title: 'X', status: 'full' });
      expect(result).toBeNull();
      const rows = await rawDb.execute<{ deleted_at: string | null; title: string | null }>(
        sql`select deleted_at, title from links where id = ${link.id}`,
      );
      expect(rows.rows[0]?.deleted_at).not.toBeNull();
      expect(rows.rows[0]?.title).toBeNull();
    });
  });
});
