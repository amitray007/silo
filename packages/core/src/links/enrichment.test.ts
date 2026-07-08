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

    it('rejects a title that exceeds even the clamp ceiling — impossible via recordEnrichment, proven directly against the schema', () => {
      // recordEnrichment clamps every string field to its ceiling BEFORE
      // parsing (see enrichment.ts), so no caller can ever trigger a
      // too_big ZodError through the public function — that's the whole
      // point of this fix. This asserts the schema's own max is still
      // enforced when called directly (bypassing the clamp), so the ceiling
      // itself isn't silently regressed to "no limit".
      expect(() =>
        enrichmentOps.enrichmentResultSchema.parse({ title: 'x'.repeat(5_001), status: 'full' }),
      ).toThrow();
    });
  });

  describe('recordEnrichment — clamping (total write, no field size can throw)', () => {
    it('an oversized imageUrl (TS-docs data: URI repro) does not throw and records the link, clamped to the ceiling', async () => {
      const created = await linksOps.createLink({
        url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
        sourceKind: 'link',
      });

      const oversizedImageUrl = `data:image/png;base64,${'A'.repeat(70_000)}`;
      expect(oversizedImageUrl.length).toBeGreaterThan(65_536);

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        title: 'TypeScript: Documentation',
        text: 'The TypeScript handbook.',
        imageUrl: oversizedImageUrl,
      });

      expect(updated).not.toBeNull();
      expect(updated?.captureStatus).toBe('full');
      expect(updated?.imageUrl).not.toBeNull();
      expect(updated?.imageUrl?.length).toBe(65_536);
      expect(updated?.imageUrl?.startsWith('data:image/png;base64,')).toBe(true);

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.captureStatus).toBe('full');
      expect(fetched?.imageUrl?.length).toBe(65_536);
    });

    it('oversized text is clamped to the ceiling, not rejected', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-oversized-text',
        sourceKind: 'link',
      });

      const oversizedText = 'a'.repeat(5_000_001);

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        text: oversizedText,
      });

      expect(updated).not.toBeNull();
      expect(updated?.captureStatus).toBe('full');
      expect(updated?.extractedText?.length).toBe(5_000_000);
    });

    it('in-bounds values pass through unchanged (regression guard)', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-in-bounds',
        sourceKind: 'link',
      });

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        title: 'A Normal Title',
        description: 'A normal, short description.',
        imageUrl: 'https://example.com/og-image.png',
        siteName: 'Example Site',
        text: 'Some normal, in-bounds article text.',
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('A Normal Title');
      expect(updated?.description).toBe('A normal, short description.');
      expect(updated?.imageUrl).toBe('https://example.com/og-image.png');
      expect(updated?.siteName).toBe('Example Site');
      expect(updated?.extractedText).toBe('Some normal, in-bounds article text.');
      expect(updated?.captureStatus).toBe('full');
    });

    it('a data: URI within the ceiling is preserved verbatim, not dropped', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-inline-image',
        sourceKind: 'link',
      });

      const shortDataUri =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      expect(shortDataUri.length).toBeLessThanOrEqual(65_536);

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        imageUrl: shortDataUri,
      });

      expect(updated).not.toBeNull();
      expect(updated?.imageUrl).toBe(shortDataUri);

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.imageUrl).toBe(shortDataUri);
    });
  });

  describe('recordEnrichment — tsvector bound (search_vector must never overflow Postgres 1MB limit)', () => {
    it('a ~2M-char, high-lexeme extracted_text writes clean and search_vector is non-null', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-tsvector-bound',
        sourceKind: 'link',
      });

      // High-lexeme-density text: ~200,000 UNIQUE tokens (not a repeated
      // single char, which Postgres's tsvector collapses to ~1 lexeme and
      // wouldn't stress serialization at all). This is the pathological case
      // the schema's `left(...)` bounds guard against — see the doc comment
      // on `searchVector` in packages/db/src/schema/links.ts and migration
      // 0006_gorgeous_makkari.sql: WITHOUT those bounds, this same write
      // throws "string is too long for tsvector" (verified manually by
      // temporarily reverting the schema's left() wrapping and re-running
      // this test — it failed with that exact error; restored after).
      const text = Array.from({ length: 200_000 }, (_, i) => `lex${i}`).join(' ');
      expect(text.length).toBeGreaterThan(1_000_000);

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        text,
      });

      expect(updated).not.toBeNull();
      expect(updated?.captureStatus).toBe('full');

      const rows = await rawDb.execute<{ search_vector: string | null }>(
        sql`select search_vector from links where id = ${created.id}`,
      );
      expect(rows.rows[0]?.search_vector).not.toBeNull();
    });
  });

  describe('recordEnrichment — sourceData', () => {
    it('writes a valid hacker_news sourceData payload and syncs sourceKind', async () => {
      const created = await linksOps.createLink({
        url: 'https://news.ycombinator.com/item?id=555',
        sourceKind: 'link',
      });
      // createLink auto-detects the sourceKind for enricher routing but keeps
      // sourceData at the safe `link` floor until enrichment runs.
      expect(created.sourceKind).toBe('hacker_news');
      expect(created.sourceData).toEqual({ kind: 'link' });

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        sourceData: { kind: 'hacker_news', points: 250, comments: 84, author: 'pg' },
      });

      expect(updated).not.toBeNull();
      expect(updated?.sourceKind).toBe('hacker_news');
      expect(updated?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 250,
        comments: 84,
        author: 'pg',
      });

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 250,
        comments: 84,
        author: 'pg',
      });
    });

    it('writes a valid github sourceData payload', async () => {
      const created = await linksOps.createLink({
        url: 'https://github.com/vercel/next.js',
        sourceKind: 'link',
      });
      expect(created.sourceKind).toBe('github');

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        sourceData: {
          kind: 'github',
          stars: 120000,
          forks: 26000,
          issues: 3000,
          description: 'The React Framework',
          language: 'JavaScript',
        },
      });

      expect(updated?.sourceData).toMatchObject({ kind: 'github', stars: 120000 });
    });

    it('writes a valid youtube sourceData payload', async () => {
      const created = await linksOps.createLink({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        sourceKind: 'link',
      });
      expect(created.sourceKind).toBe('youtube');

      const updated = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        sourceData: {
          kind: 'youtube',
          channel: 'Rick Astley',
          thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        },
      });

      expect(updated?.sourceData).toMatchObject({ kind: 'youtube', channel: 'Rick Astley' });
    });

    it('omitting sourceData (a degraded/best-effort enrichment) keeps the existing payload (dont-clobber)', async () => {
      const created = await linksOps.createLink({
        url: 'https://news.ycombinator.com/item?id=556',
        sourceKind: 'hacker_news',
        sourceData: { kind: 'hacker_news', points: 10, comments: 2, author: 'someone' },
      });

      // A subsequent enrichment pass that DIDN'T successfully run the source
      // enricher (e.g. HN Firebase rate-limited) omits sourceData entirely —
      // the prior good payload must survive untouched.
      const updated = await enrichmentOps.recordEnrichment(created.id, { status: 'full' });

      expect(updated?.sourceKind).toBe('hacker_news');
      expect(updated?.sourceData).toEqual({
        kind: 'hacker_news',
        points: 10,
        comments: 2,
        author: 'someone',
      });
    });

    it('rejects an invalid sourceData shape before any write', async () => {
      const created = await linksOps.createLink({
        url: 'https://example.com/enrich-bad-source-data',
        sourceKind: 'link',
      });

      await expect(
        enrichmentOps.recordEnrichment(created.id, {
          status: 'full',
          sourceData: { kind: 'hacker_news', points: 1 } as never,
        }),
      ).rejects.toThrow();

      const fetched = await linksOps.getById(created.id);
      expect(fetched?.sourceData).toEqual({ kind: 'link' });
      expect(fetched?.captureStatus).toBe('enriching');
    });

    it('does not write sourceData/sourceKind on a trashed link', async () => {
      const created = await linksOps.createLink({
        url: 'https://news.ycombinator.com/item?id=557',
        sourceKind: 'link',
      });
      await linksOps.softDelete(created.id);

      const result = await enrichmentOps.recordEnrichment(created.id, {
        status: 'full',
        sourceData: { kind: 'hacker_news', points: 1, comments: 1, author: 'x' },
      });

      expect(result).toBeNull();
      const rows = await rawDb.execute<{ source_kind: string; source_data: unknown }>(
        sql`select source_kind, source_data from links where id = ${created.id}`,
      );
      expect(rows.rows[0]?.source_kind).toBe('hacker_news');
      expect(rows.rows[0]?.source_data).toEqual({ kind: 'link' });
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
