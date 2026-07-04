import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md):
 * dedup/merge, TOCTOU, trash/restore, search ranking, and tag m2m behavior
 * are all database-level behaviors mocks can't prove.
 *
 * See `../test-support/pg-harness.ts` for why the module under test is
 * loaded via a dynamic `import()` inside the harness's `beforeAll`.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('links operations (integration)', () => {
  const harness = setupPgHarness('silo_core_links_test', () => import('./links.js'));
  let ops: typeof LinksOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    ops = harness.mod();
    rawDb = harness.rawDb();
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

  /** Walk every `list()` page via `nextCursor` (small limit, guarded against an infinite loop) and return every link id seen, in page order. */
  async function walkAllListPages(
    filter: Parameters<typeof LinksOps.list>[0] = {},
    limit = 2,
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const { links: page, nextCursor } = await ops.list(
        filter,
        cursor === undefined ? { limit } : { limit, cursor },
      );
      seen.push(...page.map((l) => l.id));
      cursor = nextCursor;
      guard++;
    } while (cursor !== undefined && guard < 10);
    return seen;
  }

  /** Set `created_at` for every given link id to the same raw timestamptz literal (e.g. to force a microsecond-precision tie). */
  async function forceCreatedAt(ids: ReadonlyArray<string>, createdAt: string): Promise<void> {
    await rawDb.execute(
      sql`update links set created_at = ${createdAt}::timestamptz where id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  /** Set each link id to its OWN raw timestamptz literal (one UPDATE per pair), for building precise microsecond spreads. */
  async function setCreatedAtEach(pairs: ReadonlyArray<readonly [string, string]>): Promise<void> {
    for (const [id, createdAt] of pairs) {
      await rawDb.execute(
        sql`update links set created_at = ${createdAt}::timestamptz where id = ${id}`,
      );
    }
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
      expect(withTagA.links.map((l) => l.id)).toContain(first.id);
      expect(withTagB.links.map((l) => l.id)).toContain(first.id);
      expect(withTagC.links.map((l) => l.id)).toContain(first.id);
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
      expect(withA.links.map((l) => l.id)).toContain(a.id);
      expect(withB.links.map((l) => l.id)).toContain(a.id);
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
      expect(listAfterTrash.links.map((l) => l.id)).not.toContain(created.id);
      const searchAfterTrash = await ops.search('Keyword');
      expect(searchAfterTrash.results.map((r) => r.id)).not.toContain(created.id);

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
      expect((await ops.list({ tag: 'keep' })).links.map((l) => l.id)).toContain(created.id);
      expect((await ops.list({ tag: 'fresh' })).links.map((l) => l.id)).toContain(created.id);
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
      expect(withOldTag.links.map((l) => l.id)).toContain(liveReplacement.id);
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

      const { results } = await ops.search('octopus');
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
      expect(withTag.links.map((l) => l.id).sort()).toEqual([linkA.id, linkB.id].sort());
    });

    it('removeTag unlinks without deleting the tag row', async () => {
      const link = await ops.createLink({
        url: 'https://example.com/untag-me',
        sourceKind: 'link',
      });
      await ops.addTag(link.id, 'sticky');

      await ops.removeTag(link.id, 'sticky');

      const withTag = await ops.list({ tag: 'sticky' });
      expect(withTag.links.map((l) => l.id)).not.toContain(link.id);

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
      expect(result.links).toHaveLength(1);
      expect(result.links[0]?.id).toBe(tagged.id);
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
      expect(fullOnly.links.map((l) => l.id)).toEqual([full.id]);

      const bareOnly = await ops.list({ status: 'bare' });
      expect(bareOnly.links.map((l) => l.id)).toEqual([bare.id]);
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

  describe('tag hydration', () => {
    it('getById returns sorted tags, and [] for a link with none', async () => {
      const tagged = await ops.createLink({
        url: 'https://example.com/hydrate-getbyid',
        tags: ['zebra', 'apple', 'mango'],
        sourceKind: 'link',
      });
      const untagged = await ops.createLink({
        url: 'https://example.com/hydrate-getbyid-none',
        sourceKind: 'link',
      });

      const fetchedTagged = await ops.getById(tagged.id);
      expect(fetchedTagged?.tags).toEqual(['apple', 'mango', 'zebra']);

      const fetchedUntagged = await ops.getById(untagged.id);
      expect(fetchedUntagged?.tags).toEqual([]);
    });

    it('list hydrates multiple links in one batched call, preserving order and per-link tags', async () => {
      const a = await ops.createLink({
        url: 'https://example.com/hydrate-batch-a',
        tags: ['b-tag', 'a-tag'],
        sourceKind: 'link',
      });
      const b = await ops.createLink({
        url: 'https://example.com/hydrate-batch-b',
        sourceKind: 'link',
      });
      const c = await ops.createLink({
        url: 'https://example.com/hydrate-batch-c',
        tags: ['only-c'],
        sourceKind: 'link',
      });

      const { links: page } = await ops.list();
      const byId = new Map(page.map((l) => [l.id, l]));

      expect(byId.get(a.id)?.tags).toEqual(['a-tag', 'b-tag']);
      expect(byId.get(b.id)?.tags).toEqual([]);
      expect(byId.get(c.id)?.tags).toEqual(['only-c']);

      // Newest-first order preserved through hydration: c, b, a were created
      // in that order, so c is newest.
      const ids = page.map((l) => l.id);
      expect(ids.indexOf(c.id)).toBeLessThan(ids.indexOf(b.id));
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    });
  });

  describe('list pagination (keyset)', () => {
    it('pages through every row exactly once via nextCursor, last page has none', async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const link = await ops.createLink({
          url: `https://example.com/keyset-${i}`,
          sourceKind: 'link',
        });
        created.push(link.id);
      }

      const seen = await walkAllListPages();

      // Every created id appears exactly once across all pages.
      expect(seen.sort()).toEqual([...created].sort());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('BUG 1 regression: rows sharing an IDENTICAL (microsecond-precision) created_at are never dropped', async () => {
      // Reproduces the original bug: node-postgres surfaces `created_at` as a
      // JS `Date` (millisecond precision), but the column itself is
      // microsecond precision. `encodeListCursor` serializes via
      // `toISOString()` (ms), so comparing the RAW column against that
      // ms-truncated cursor value made the tie branch `created_at =
      // cursorCreatedAt` false for rows that only tie at microsecond
      // resolution — silently skipping them. Force five rows onto the exact
      // same microsecond timestamp and page through with a small limit: every
      // row must come back exactly once.
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const link = await ops.createLink({
          url: `https://example.com/tied-created-at-${i}`,
          sourceKind: 'link',
        });
        created.push(link.id);
      }
      await forceCreatedAt(created, '2026-04-04 08:00:00.222222+00');

      const seen = await walkAllListPages();

      expect(seen.sort()).toEqual([...created].sort());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('BUG 1 regression (sub-millisecond spread): rows in ONE ms bucket with DISTINCT microsecond values all walk exactly once', async () => {
      // The subtle case a millisecond-truncating predicate gets wrong: rows
      // that are NOT exact ties but share a millisecond bucket while differing
      // in microseconds. `ORDER BY created_at DESC` sorts on the raw µs column,
      // so these rows have a real, strict order — but a predicate that
      // truncated the column to ms would treat them as tied and fall to the
      // `id` tiebreak, which has no relation to their true µs order, silently
      // dropping rows across a page boundary. The keyset must compare the RAW
      // column against a full-µs-precision cursor so WHERE and ORDER BY agree.
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const link = await ops.createLink({
          url: `https://example.com/submilli-${i}`,
          sourceKind: 'link',
        });
        created.push(link.id);
      }
      // All within the SAME millisecond (.100xxx) but each a distinct
      // microsecond value, deliberately assigned so µs-order and id-order do
      // NOT coincide (this is what makes the id tiebreak actively wrong).
      const micros = ['.100999', '.100001', '.100500', '.100250', '.100750'];
      await setCreatedAtEach(
        created.map((id, i) => [id, `2026-06-06 10:00:00${micros[i]}+00`] as const),
      );

      const seen = await walkAllListPages({}, 1);

      expect(seen.sort()).toEqual([...created].sort());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('BUG 1 regression (mixed): some rows tied on created_at, some distinct, all walk exactly once', async () => {
      const tiedIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const link = await ops.createLink({
          url: `https://example.com/mixed-tied-${i}`,
          sourceKind: 'link',
        });
        tiedIds.push(link.id);
      }
      await forceCreatedAt(tiedIds, '2026-05-05 09:30:00.333333+00');

      const distinctIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const link = await ops.createLink({
          url: `https://example.com/mixed-distinct-${i}`,
          sourceKind: 'link',
        });
        distinctIds.push(link.id);
      }

      const allIds = [...tiedIds, ...distinctIds];
      const seen = await walkAllListPages();

      expect(seen.sort()).toEqual([...allIds].sort());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('BUG 2 regression: a list cursor with a non-uuid id throws InvalidCursorError, not a raw DB error', async () => {
      const forgedCursor = Buffer.from(
        JSON.stringify({
          kind: 'list',
          createdAt: new Date().toISOString(),
          id: 'not-a-uuid-at-all',
        }),
        'utf8',
      ).toString('base64url');

      await expect(ops.list({}, { cursor: forgedCursor })).rejects.toThrow(ops.InvalidCursorError);
    });

    it('BUG 2 regression: a well-formed-but-non-uuid id (36 chars, wrong shape) also throws InvalidCursorError', async () => {
      const forgedCursor = Buffer.from(
        JSON.stringify({
          kind: 'list',
          createdAt: new Date().toISOString(),
          // Same length as a uuid but not the 8-4-4-4-12 hex shape.
          id: 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
        }),
        'utf8',
      ).toString('base64url');

      await expect(ops.list({}, { cursor: forgedCursor })).rejects.toThrow(ops.InvalidCursorError);
    });

    it('a well-formed valid-uuid cursor still round-trips normally', async () => {
      for (let i = 0; i < 3; i++) {
        await ops.createLink({ url: `https://example.com/valid-cursor-${i}`, sourceKind: 'link' });
      }
      const page1 = await ops.list({}, { limit: 1 });
      expect(page1.nextCursor).toBeDefined();
      const page2 = await ops.list({}, { limit: 10, cursor: page1.nextCursor as string });
      expect(page2.links.length).toBeGreaterThan(0);
    });

    it('keyset paging is stable when a row is inserted between page fetches', async () => {
      const first = await ops.createLink({
        url: 'https://example.com/keyset-stable-1',
        sourceKind: 'link',
      });
      const second = await ops.createLink({
        url: 'https://example.com/keyset-stable-2',
        sourceKind: 'link',
      });

      const page1 = await ops.list({}, { limit: 1 });
      expect(page1.links.map((l) => l.id)).toEqual([second.id]);
      expect(page1.nextCursor).toBeDefined();

      // Insert a brand-new (newest) row between page fetches. Because it
      // sorts ahead of the cursor position, it must NOT appear on page 2 nor
      // cause `first`/`second` to be dropped or duplicated.
      const insertedMidPaging = await ops.createLink({
        url: 'https://example.com/keyset-stable-inserted',
        sourceKind: 'link',
      });

      const page2 = await ops.list({}, { limit: 10, cursor: page1.nextCursor as string });
      const page2Ids = page2.links.map((l) => l.id);
      expect(page2Ids).toContain(first.id);
      expect(page2Ids).not.toContain(second.id);
      expect(page2Ids).not.toContain(insertedMidPaging.id);
      expect(page2.nextCursor).toBeUndefined();
    });

    it('trashed links never appear in any page', async () => {
      const live = await ops.createLink({
        url: 'https://example.com/keyset-live',
        sourceKind: 'link',
      });
      const trashed = await ops.createLink({
        url: 'https://example.com/keyset-trashed',
        sourceKind: 'link',
      });
      await ops.softDelete(trashed.id);

      const { links: page, nextCursor } = await ops.list();
      expect(page.map((l) => l.id)).toContain(live.id);
      expect(page.map((l) => l.id)).not.toContain(trashed.id);
      expect(nextCursor).toBeUndefined();
    });

    it('empty result set has no nextCursor', async () => {
      const { links: page, nextCursor } = await ops.list({ tag: 'does-not-exist' });
      expect(page).toEqual([]);
      expect(nextCursor).toBeUndefined();
    });

    it('limit clamps: 0 still returns at least 1 row, 1000 is capped at 100', async () => {
      for (let i = 0; i < 3; i++) {
        await ops.createLink({ url: `https://example.com/clamp-${i}`, sourceKind: 'link' });
      }

      const zeroLimit = await ops.list({}, { limit: 0 });
      expect(zeroLimit.links).toHaveLength(1);

      const hugeLimit = await ops.list({}, { limit: 1000 });
      expect(hugeLimit.links.length).toBeLessThanOrEqual(100);
      expect(hugeLimit.links.length).toBe(3);

      // A non-finite limit (e.g. NaN from a malformed caller) never reaches
      // the query as an invalid value — falls back to the default (20).
      const nanLimit = await ops.list({}, { limit: Number.NaN });
      expect(nanLimit.links.length).toBe(3);
    });

    it('a malformed cursor throws InvalidCursorError', async () => {
      await expect(ops.list({}, { cursor: 'not-valid-base64json' })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('a search cursor fed to list throws InvalidCursorError (not a silent wrong result)', async () => {
      const { nextCursor } = await ops.search('nonexistent-query-xyz', { limit: 1 });
      // No results, so nextCursor is undefined; build a well-formed *search*
      // cursor directly to prove the cross-tool-cursor rejection, since we
      // need a payload with kind: 'search' to feed into `list`.
      expect(nextCursor).toBeUndefined();
      const searchShapedCursor = Buffer.from(
        JSON.stringify({ kind: 'search', offset: 0 }),
        'utf8',
      ).toString('base64url');

      await expect(ops.list({}, { cursor: searchShapedCursor })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });
  });

  describe('search pagination (offset)', () => {
    it('round-trips an offset cursor across pages without dup/drop', async () => {
      for (let i = 0; i < 5; i++) {
        await ops.createLink({
          url: `https://example.com/search-page-${i}`,
          title: 'searchword pagination test',
          sourceKind: 'link',
        });
      }

      const seenIds: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const { results, nextCursor } = await ops.search(
          'searchword',
          cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
        );
        seenIds.push(...results.map((r) => r.id));
        cursor = nextCursor;
        guard++;
      } while (cursor !== undefined && guard < 10);

      expect(seenIds).toHaveLength(5);
      expect(new Set(seenIds).size).toBe(5);
    });

    it('last page has no nextCursor; empty results have no nextCursor', async () => {
      await ops.createLink({
        url: 'https://example.com/search-onepage',
        title: 'uniquesearchtermonly',
        sourceKind: 'link',
      });

      const { nextCursor } = await ops.search('uniquesearchtermonly', { limit: 10 });
      expect(nextCursor).toBeUndefined();

      const empty = await ops.search('termnobodywrote');
      expect(empty.results).toEqual([]);
      expect(empty.nextCursor).toBeUndefined();
    });

    it('search results are tag-hydrated', async () => {
      await ops.createLink({
        url: 'https://example.com/search-hydrated',
        title: 'hydratesearchterm',
        tags: ['search-tag'],
        sourceKind: 'link',
      });

      const { results } = await ops.search('hydratesearchterm');
      expect(results[0]?.tags).toEqual(['search-tag']);
    });

    it('rank stays bound to its OWN link when ranks differ (guards hydrateTags order-preservation)', async () => {
      // `search` re-attaches `rank` to hydrated results by array index
      // (`page_[i]?.rank`), which only stays correct if `hydrateTags`
      // preserves input row order. Use rows with clearly different
      // searchword density so ranks are distinct, then confirm each result's
      // rank matches ITS OWN link, not a neighbor's (which a hydration
      // reorder would silently produce).
      const highRank = await ops.createLink({
        url: 'https://example.com/rank-high',
        title: 'rankterm rankterm rankterm',
        description: 'rankterm rankterm',
        sourceKind: 'link',
      });
      const midRank = await ops.createLink({
        url: 'https://example.com/rank-mid',
        title: 'rankterm',
        sourceKind: 'link',
      });
      const lowRank = await ops.createLink({
        url: 'https://example.com/rank-low',
        extractedText: 'a passing mention of rankterm deep in the body text',
        sourceKind: 'link',
      });

      const { results } = await ops.search('rankterm');
      const byId = new Map(results.map((r) => [r.id, r]));

      const highRankValue = byId.get(highRank.id)?.rank ?? -1;
      const midRankValue = byId.get(midRank.id)?.rank ?? -1;
      const lowRankValue = byId.get(lowRank.id)?.rank ?? -1;

      // Distinct ranks confirm the ordering actually differentiates rows —
      // otherwise a swapped attachment could go unnoticed.
      expect(highRankValue).toBeGreaterThan(midRankValue);
      expect(midRankValue).toBeGreaterThan(lowRankValue);

      // Results are ts_rank DESC, so index order must exactly match rank
      // order — proving each result's `rank` is the one computed FOR that
      // link, not a neighbor's.
      expect(results.map((r) => r.id)).toEqual([highRank.id, midRank.id, lowRank.id]);
      expect(results.map((r) => r.rank)).toEqual(
        [...results.map((r) => r.rank)].sort((a, b) => b - a),
      );
    });

    it('limit clamps: 0 still returns at least 1 row, 1000 is capped at 100', async () => {
      for (let i = 0; i < 3; i++) {
        await ops.createLink({
          url: `https://example.com/search-clamp-${i}`,
          title: 'clampsearchterm',
          sourceKind: 'link',
        });
      }

      const zeroLimit = await ops.search('clampsearchterm', { limit: 0 });
      expect(zeroLimit.results).toHaveLength(1);

      const hugeLimit = await ops.search('clampsearchterm', { limit: 1000 });
      expect(hugeLimit.results.length).toBeLessThanOrEqual(100);
      expect(hugeLimit.results.length).toBe(3);
    });

    it('a malformed cursor throws InvalidCursorError', async () => {
      await expect(ops.search('anything', { cursor: '!!!not-base64!!!' })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('a forged cursor with a fractional offset throws InvalidCursorError', async () => {
      const fractionalOffsetCursor = Buffer.from(
        JSON.stringify({ kind: 'search', offset: 1.5 }),
        'utf8',
      ).toString('base64url');

      await expect(ops.search('anything', { cursor: fractionalOffsetCursor })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('BUG 3 regression: a forged offset beyond the maximum throws InvalidCursorError', async () => {
      // MAX_OFFSET = MAX_LIMIT * 100 = 10_000 (see pagination.ts). A forged
      // cursor asking to skip past that depth must be rejected outright, not
      // silently run as a full sort-then-discard.
      const beyondMaxOffsetCursor = Buffer.from(
        JSON.stringify({ kind: 'search', offset: 10_001 }),
        'utf8',
      ).toString('base64url');

      await expect(ops.search('anything', { cursor: beyondMaxOffsetCursor })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('an offset at or under the maximum still round-trips normally', async () => {
      const atMaxOffsetCursor = Buffer.from(
        JSON.stringify({ kind: 'search', offset: 10_000 }),
        'utf8',
      ).toString('base64url');

      // No rows at that depth, but decode/validate must succeed and just
      // return an empty page — never throw for a within-bounds offset.
      const { results, nextCursor } = await ops.search('anything', {
        cursor: atMaxOffsetCursor,
      });
      expect(results).toEqual([]);
      expect(nextCursor).toBeUndefined();
    });

    it('a list cursor fed to search throws InvalidCursorError (not a silent wrong result)', async () => {
      await ops.createLink({ url: 'https://example.com/cross-cursor-1', sourceKind: 'link' });
      await ops.createLink({ url: 'https://example.com/cross-cursor-2', sourceKind: 'link' });

      const { nextCursor } = await ops.list({}, { limit: 1 });
      expect(nextCursor).toBeDefined();

      await expect(ops.search('anything', { cursor: nextCursor as string })).rejects.toThrow(
        ops.InvalidCursorError,
      );
    });

    it('trashed links never appear in search pages', async () => {
      const live = await ops.createLink({
        url: 'https://example.com/search-trash-page',
        title: 'trashsearchpageterm',
        sourceKind: 'link',
      });
      const trashed = await ops.createLink({
        url: 'https://example.com/search-trash-page-2',
        title: 'trashsearchpageterm',
        sourceKind: 'link',
      });
      await ops.softDelete(trashed.id);

      const { results } = await ops.search('trashsearchpageterm');
      expect(results.map((r) => r.id)).toContain(live.id);
      expect(results.map((r) => r.id)).not.toContain(trashed.id);
    });
  });
});
