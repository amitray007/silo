import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as LinksOps from './links.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md):
 * dedup/merge, TOCTOU, trash/restore, search ranking, and tag m2m behavior
 * are all database-level behaviors mocks can't prove.
 *
 * `@silo/db`'s `db`/`pool` singleton (which `links.ts` imports) reads
 * `DATABASE_URL` at module-load time (see `packages/db/src/client.ts`), so
 * the env var must be set to THIS suite's disposable database before
 * `./links.js` is first imported anywhere — hence the dynamic `import()`
 * inside `beforeAll`, after the env var is set, rather than a static
 * top-level import (which vitest would hoist ahead of the env-var write).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('links operations (integration)', () => {
  let dropDatabase: () => void;
  let ops: typeof LinksOps;
  let rawDb: ReturnType<typeof drizzle>;
  let rawPool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_core_links_test');
    dropDatabase = database.drop;

    const migratePool = new Pool({ connectionString: database.url });
    const migrateDb = drizzle(migratePool);
    // runMigrations closes migratePool for us. Path is relative to this
    // test file's cwd (packages/core), so it reaches back to db's migrations.
    await runMigrations(migrateDb, migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    ops = await import('./links.js');

    rawPool = new Pool({ connectionString: database.url });
    rawDb = drizzle(rawPool);
  });

  afterAll(async () => {
    // Close the @silo/db singleton pool `ops` (links.ts) runs on too — it's
    // never closed by anything else, and dropping the database with an open
    // connection still attached to it fires a noisy (but harmless) "idle
    // client" error on the pool's `error` handler otherwise.
    const { pool: opsPool } = await import('@silo/db');
    await opsPool.end();
    await rawPool.end();
    dropDatabase();
  });

  afterEach(async () => {
    await rawDb.execute(sql`TRUNCATE TABLE link_tags, links, tags RESTART IDENTITY CASCADE`);
  });

  async function liveCountForCanonicalUrl(canonicalUrl: string): Promise<number> {
    const rows = await rawDb.execute<{ count: string }>(
      sql`select count(*) from links where canonical_url = ${canonicalUrl} and deleted_at is null`,
    );
    return Number(rows.rows[0]?.count ?? '0');
  }

  async function totalCountForCanonicalUrl(canonicalUrl: string): Promise<number> {
    const rows = await rawDb.execute<{ count: string }>(
      sql`select count(*) from links where canonical_url = ${canonicalUrl}`,
    );
    return Number(rows.rows[0]?.count ?? '0');
  }

  describe('createLink — happy path', () => {
    it('inserts a new link with status=enriching; getById returns it typed', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/new-article',
        title: 'A New Article',
        sourceKind: 'link',
      });

      expect(created.captureStatus).toBe('enriching');
      expect(created.canonicalUrl).toBe('https://example.com/new-article');
      expect(created.deletedAt).toBeNull();

      const fetched = await ops.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.title).toBe('A New Article');
    });

    it('rejects an invalid source_data shape before insert', async () => {
      await expect(
        ops.createLink({
          url: 'https://example.com/bad-source-data',
          sourceKind: 'hacker_news',
          // Missing required hacker_news fields (points/comments/author).
          sourceData: { kind: 'hacker_news' } as never,
        }),
      ).rejects.toThrow();

      const found = await ops.findByCanonicalUrl('https://example.com/bad-source-data');
      expect(found).toBeNull();
    });
  });

  describe('createLink — dedup / merge', () => {
    it('merges a tracking-param variant of the same url into one row (not a twin)', async () => {
      const first = await ops.createLink({
        url: 'https://example.com/dedup-me',
        tags: ['reading'],
        notes: 'first note',
        sourceKind: 'link',
      });

      const second = await ops.createLink({
        url: 'https://example.com/dedup-me?utm_source=newsletter',
        tags: ['later'],
        notes: 'second note',
        sourceKind: 'link',
      });

      expect(second.id).toBe(first.id);
      expect(await totalCountForCanonicalUrl('https://example.com/dedup-me')).toBe(1);

      expect(second.notes).toContain('first note');
      expect(second.notes).toContain('second note');
    });

    it('unions tags across merged saves (second save reusing + adding tags)', async () => {
      const first = await ops.createLink({
        url: 'https://example.com/tag-union',
        tags: ['a', 'b'],
        sourceKind: 'link',
      });
      await ops.createLink({
        url: 'https://example.com/tag-union',
        tags: ['b', 'c'],
        sourceKind: 'link',
      });

      const withTagA = await ops.list({ tag: 'a' });
      const withTagB = await ops.list({ tag: 'b' });
      const withTagC = await ops.list({ tag: 'c' });
      expect(withTagA.map((l) => l.id)).toContain(first.id);
      expect(withTagB.map((l) => l.id)).toContain(first.id);
      expect(withTagC.map((l) => l.id)).toContain(first.id);
    });

    it('falls back to merge when a concurrent insert wins the TOCTOU race (23505 caught)', async () => {
      // Two concurrent createLink calls for a brand-new url race each
      // other's read-then-insert window; whichever loses the insert must
      // catch the 23505 and fall back to merging into the winner's row
      // rather than surfacing the raw constraint violation.
      const url = 'https://example.com/race-me';
      const [a, b] = await Promise.all([
        ops.createLink({ url, tags: ['racer-a'], sourceKind: 'link' }),
        ops.createLink({ url, tags: ['racer-b'], sourceKind: 'link' }),
      ]);

      expect(a.id).toBe(b.id);
      expect(await totalCountForCanonicalUrl('https://example.com/race-me')).toBe(1);

      const withA = await ops.list({ tag: 'racer-a' });
      const withB = await ops.list({ tag: 'racer-b' });
      expect(withA.map((l) => l.id)).toContain(a.id);
      expect(withB.map((l) => l.id)).toContain(a.id);
    });
  });

  describe('createLink — ok:false urls are never deduped', () => {
    it('creates two separate rows for two saves of an unnormalizable/unsafe url', async () => {
      const rawUrl = 'javascript:alert(1)';
      const first = await ops.createLink({ url: rawUrl, sourceKind: 'link' });
      const second = await ops.createLink({ url: rawUrl, sourceKind: 'link' });

      expect(second.id).not.toBe(first.id);
      // The raw, unmodified url is always preserved in `url` (the display
      // column) regardless of `ok`.
      expect(first.url).toBe(rawUrl);
      expect(second.url).toBe(rawUrl);
      // `canonical_url` is a pure internal dedup key for ok:false rows —
      // documented policy disambiguates it (see links.ts createLink doc
      // comment) so two undeduped rows never collide on the partial-unique
      // index. It is never matched/looked-up, so its exact stored form is
      // an implementation detail; assert only that it's never used to merge
      // the two rows together (already covered by the id assertion above)
      // and that it still starts with the raw url.
      expect(first.canonicalUrl.startsWith(rawUrl)).toBe(true);
      expect(second.canonicalUrl.startsWith(rawUrl)).toBe(true);
      expect(first.canonicalUrl).not.toBe(second.canonicalUrl);

      // findByCanonicalUrl must never match an ok:false url either.
      expect(await ops.findByCanonicalUrl(rawUrl)).toBeNull();
    });
  });

  describe('trash round-trip', () => {
    it('softDelete hides from list/search; restore brings it back', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/trash-roundtrip',
        title: 'Trashable Title Keyword',
        sourceKind: 'link',
      });

      await ops.softDelete(created.id);
      expect(await ops.getById(created.id)).toBeNull();
      const listAfterTrash = await ops.list();
      expect(listAfterTrash.map((l) => l.id)).not.toContain(created.id);
      const searchAfterTrash = await ops.search('Keyword');
      expect(searchAfterTrash.map((l) => l.id)).not.toContain(created.id);

      const result = await ops.restore(created.id);
      expect(result.status).toBe('restored');
      if (result.status === 'not_found') throw new Error('expected restored');
      expect(result.link.deletedAt).toBeNull();

      const fetched = await ops.getById(created.id);
      expect(fetched).not.toBeNull();
    });

    it('re-saving a trashed url REVIVES the original and merges notes/tags (no duplicate)', async () => {
      // Product decision (U4 review): re-saving a trashed url un-trashes the
      // original and merges the new notes/tags into it — the user gets their
      // ONE item back with earlier annotations preserved, not a fresh empty
      // duplicate plus a hidden stale trashed copy.
      const created = await ops.createLink({
        url: 'https://example.com/trash-resave',
        notes: 'original note',
        tags: ['keep'],
        sourceKind: 'link',
      });
      await ops.softDelete(created.id);
      expect(await ops.getById(created.id)).toBeNull();

      const resaved = await ops.createLink({
        url: 'https://example.com/trash-resave',
        notes: 'resave note',
        tags: ['fresh'],
        sourceKind: 'link',
      });
      // Same row, revived — not a new one.
      expect(resaved.id).toBe(created.id);
      expect(resaved.deletedAt).toBeNull();
      // Notes appended, earlier note preserved.
      expect(resaved.notes).toContain('original note');
      expect(resaved.notes).toContain('resave note');
      // Only one row for that canonical url, and it's live.
      expect(await liveCountForCanonicalUrl('https://example.com/trash-resave')).toBe(1);
      // Both the original and the fresh tag are present.
      expect((await ops.list({ tag: 'keep' })).map((l) => l.id)).toContain(created.id);
      expect((await ops.list({ tag: 'fresh' })).map((l) => l.id)).toContain(created.id);
    });

    it('re-saving a live url with a richer source_data updates the stored payload (no drop)', async () => {
      const created = await ops.createLink({
        url: 'https://news.ycombinator.com/item?id=1',
        sourceKind: 'link',
      });
      expect(created.sourceKind).toBe('link');

      const enriched = await ops.createLink({
        url: 'https://news.ycombinator.com/item?id=1',
        sourceKind: 'hacker_news',
        sourceData: { kind: 'hacker_news', points: 42, comments: 7, author: 'pg' },
      });
      expect(enriched.id).toBe(created.id);
      expect(enriched.sourceKind).toBe('hacker_news');
      expect(enriched.sourceData).toMatchObject({ kind: 'hacker_news', points: 42, author: 'pg' });
    });

    it('restore-collision: folds into the live row, no two live rows, no raw 23505', async () => {
      // Produce the collision state directly: a trashed row and a live row
      // sharing one canonical_url. This can arise from a true concurrent race
      // (trash frees the slot, another save lands, then restore); we set it up
      // deterministically by trashing the revived row is not possible now, so
      // insert the colliding live row at the db level (bypassing createLink's
      // revive) to exercise restore's collision branch.
      const original = await ops.createLink({
        url: 'https://example.com/restore-collision',
        notes: 'original notes',
        tags: ['old-tag'],
        sourceKind: 'link',
      });
      await ops.softDelete(original.id);

      const replacementRows = await rawDb.execute<{ id: string }>(
        sql`insert into links (url, canonical_url, source_kind, notes)
            values ('https://example.com/restore-collision', 'https://example.com/restore-collision', 'link', 'replacement notes')
            returning id`,
      );
      const liveReplacement = replacementRows.rows[0];
      if (!liveReplacement) throw new Error('setup: expected a live replacement row');
      expect(liveReplacement.id).not.toBe(original.id);

      const result = await ops.restore(original.id);
      expect(result.status).toBe('merged');
      if (result.status !== 'merged') throw new Error('expected merged');
      expect(result.link.id).toBe(liveReplacement.id);
      expect(result.link.deletedAt).toBeNull();
      expect(await liveCountForCanonicalUrl('https://example.com/restore-collision')).toBe(1);

      // The trashed row's notes/tags fold into the live row.
      expect(result.link.notes).toContain('replacement notes');
      expect(result.link.notes).toContain('original notes');
      const withOldTag = await ops.list({ tag: 'old-tag' });
      expect(withOldTag.map((l) => l.id)).toContain(liveReplacement.id);
    });

    it('restore on a link that is not trashed returns not_found', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/never-trashed',
        sourceKind: 'link',
      });
      const result = await ops.restore(created.id);
      expect(result.status).toBe('not_found');
    });
  });

  describe('search', () => {
    it('returns matching live links ranked and excludes trashed', async () => {
      const titleMatch = await ops.createLink({
        url: 'https://example.com/search-title',
        title: 'octopus facts',
        sourceKind: 'link',
      });
      const bodyMatch = await ops.createLink({
        url: 'https://example.com/search-body',
        title: 'unrelated',
        extractedText: 'a story that mentions octopus deep in the body',
        sourceKind: 'link',
      });
      const trashed = await ops.createLink({
        url: 'https://example.com/search-trashed',
        title: 'octopus but trashed',
        sourceKind: 'link',
      });
      await ops.softDelete(trashed.id);

      const results = await ops.search('octopus');
      const ids = results.map((r) => r.id);
      expect(ids).toContain(titleMatch.id);
      expect(ids).toContain(bodyMatch.id);
      expect(ids).not.toContain(trashed.id);

      const titleRank = results.find((r) => r.id === titleMatch.id)?.rank ?? 0;
      const bodyRank = results.find((r) => r.id === bodyMatch.id)?.rank ?? 0;
      expect(titleRank).toBeGreaterThan(bodyRank);
    });
  });

  describe('tags', () => {
    it('addTag creates a tag once; a second link reusing it does not duplicate the tag row', async () => {
      const linkA = await ops.createLink({
        url: 'https://example.com/tag-a',
        sourceKind: 'link',
      });
      const linkB = await ops.createLink({
        url: 'https://example.com/tag-b',
        sourceKind: 'link',
      });

      await ops.addTag(linkA.id, 'shared');
      await ops.addTag(linkB.id, 'shared');

      const tagRows = await rawDb.execute<{ count: string }>(
        sql`select count(*) from tags where name = 'shared'`,
      );
      expect(tagRows.rows[0]?.count).toBe('1');

      const withTag = await ops.list({ tag: 'shared' });
      expect(withTag.map((l) => l.id).sort()).toEqual([linkA.id, linkB.id].sort());
    });

    it('removeTag unlinks without deleting the tag row', async () => {
      const link = await ops.createLink({
        url: 'https://example.com/untag-me',
        sourceKind: 'link',
      });
      await ops.addTag(link.id, 'sticky');

      await ops.removeTag(link.id, 'sticky');

      const withTag = await ops.list({ tag: 'sticky' });
      expect(withTag.map((l) => l.id)).not.toContain(link.id);

      const tagRows = await rawDb.execute<{ count: string }>(
        sql`select count(*) from tags where name = 'sticky'`,
      );
      expect(tagRows.rows[0]?.count).toBe('1');
    });

    it('list filtered by tag returns only links with that tag', async () => {
      const tagged = await ops.createLink({
        url: 'https://example.com/only-tagged',
        tags: ['exclusive'],
        sourceKind: 'link',
      });
      await ops.createLink({ url: 'https://example.com/not-tagged', sourceKind: 'link' });

      const result = await ops.list({ tag: 'exclusive' });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(tagged.id);
    });
  });

  describe('list by status', () => {
    it('returns only links with the given status, live only', async () => {
      const full = await ops.createLink({
        url: 'https://example.com/status-full',
        sourceKind: 'link',
      });
      await rawDb.execute(sql`update links set capture_status = 'full' where id = ${full.id}`);

      const bare = await ops.createLink({
        url: 'https://example.com/status-bare',
        sourceKind: 'link',
      });
      await rawDb.execute(sql`update links set capture_status = 'bare' where id = ${bare.id}`);

      const trashedFull = await ops.createLink({
        url: 'https://example.com/status-full-trashed',
        sourceKind: 'link',
      });
      await rawDb.execute(
        sql`update links set capture_status = 'full' where id = ${trashedFull.id}`,
      );
      await ops.softDelete(trashedFull.id);

      const fullOnly = await ops.list({ status: 'full' });
      expect(fullOnly.map((l) => l.id)).toEqual([full.id]);

      const bareOnly = await ops.list({ status: 'bare' });
      expect(bareOnly.map((l) => l.id)).toEqual([bare.id]);
    });
  });

  describe('editLink', () => {
    it('updates fields and advances updated_at', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/editable',
        title: 'Before',
        sourceKind: 'link',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const edited = await ops.editLink(created.id, {
        title: 'After',
        description: 'A new description',
        notes: 'edited notes',
      });

      expect(edited).not.toBeNull();
      expect(edited?.title).toBe('After');
      expect(edited?.description).toBe('A new description');
      expect(edited?.notes).toBe('edited notes');
      expect(edited?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
      expect(edited?.createdAt.getTime()).toBe(created.createdAt.getTime());
    });

    it('returns null when editing a trashed or nonexistent link', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/edit-trashed',
        sourceKind: 'link',
      });
      await ops.softDelete(created.id);

      const result = await ops.editLink(created.id, { title: 'nope' });
      expect(result).toBeNull();
    });
  });
});
