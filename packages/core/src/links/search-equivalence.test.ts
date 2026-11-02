import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('library query equivalence (Postgres)', () => {
  const harness = setupPgHarness('silo_search_equivalence', async () => ({
    ...(await import('./links.js')),
    ...(await import('../test-support/legacy-library-search.js')),
    ...(await import('./live.js')),
    ...(await import('./tags.js')),
  }));

  async function seed() {
    await harness.rawDb().execute(sql`
      insert into feeds(id, feed_url, title, format, next_poll_at)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://feed.example/rss', 'Feed', 'rss', now()) on conflict do nothing;
      insert into links(id, url, canonical_url, title, description, extracted_text,
        notes, source_kind, feed_id, deleted_at, created_at)
      select md5('equivalence' || n)::uuid, 'https://example.org/' || n,
        case when n = 6 then 'https://example.org/nebula/path' else 'https://example.org/' || n end,
        case when n in (1,2,3,10,11) then 'nebula' when n = 7 then 'supernebulae' else 'Other' end,
        case when n = 4 then 'nebula descriptions' end,
        case when n = 5 then 'Full text about nebula' else 'Reading text' end,
        case when n = 8 then 'nebula notes' end, 'link',
        case when n = 11 then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid end,
        case when n = 10 then now() end, '2026-01-01'::timestamptz
      from generate_series(1,14) n;
      insert into tags(id, name, normalized_key) values
        (md5('nebula')::uuid, 'nebula', 'nebula'),
        (md5('space')::uuid, 'space', 'space'),
        (md5('flight')::uuid, 'flight', 'flight'),
        (md5('stopword')::uuid, 'the', 'the');
      insert into link_tags(link_id, tag_id) values
        (md5('equivalence9')::uuid, md5('nebula')::uuid),
        (md5('equivalence9')::uuid, md5('space')::uuid),
        (md5('equivalence12')::uuid, md5('space')::uuid),
        (md5('equivalence12')::uuid, md5('flight')::uuid),
        (md5('equivalence13')::uuid, md5('stopword')::uuid);
    `);
  }

  async function comparePages(
    query: string,
    sort: 'relevance' | 'newest' | 'oldest',
    ftsOnly: boolean,
  ) {
    const core = harness.mod();
    let cursor: string | undefined;
    const orderedIds: string[] = [];
    do {
      const page = { limit: 2, ...(cursor ? { cursor } : {}) };
      const oldPage = await core.runLegacyUnionSearch(
        core.whereLibrary(),
        core.tagSearchVector,
        query,
        undefined,
        page,
        { sort, ftsOnly, snippetFor: core.buildSnippetHeadline },
      );
      const newPage = await core.search(query, { sort }, page, { ftsOnly });
      expect(newPage, `${query}/${sort}/${ftsOnly}/${cursor}`).toEqual(oldPage);
      orderedIds.push(...newPage.results.map((row) => row.id));
      cursor = newPage.nextCursor;
    } while (cursor);
    expect(new Set(orderedIds).size).toBe(orderedIds.length);
    if (query === 'nebula') expect(orderedIds).toHaveLength(ftsOnly ? 8 : 9);
  }

  it('preserves full rows, ranks, ties, snippets and every paging cursor', async () => {
    await seed();
    for (const query of [
      'nebula',
      'ebula',
      'space flight',
      'space fl',
      'the',
      'noresultzzq',
      '',
      '  ',
      'space-flight',
      "o'brien",
      'space & flight',
      'space OR flight',
      'nebula\0',
    ]) {
      for (const sort of ['relevance', 'newest', 'oldest'] as const) {
        for (const ftsOnly of [false, true]) {
          await comparePages(query, sort, ftsOnly);
        }
      }
    }
  });

  it('preserves exact websearch counts and facets including NOT, OR, phrases and filters', async () => {
    await seed();
    const core = harness.mod();
    const { db, links, tags, linkTags } = await import('@silo/db');
    const { eq, asc, desc } = await import('drizzle-orm');
    for (const query of [
      'nebula',
      'space flight',
      '"space flight"',
      'space OR nebula',
      '-nebula',
      'space -flight',
      'space OR -nebula',
      'the',
      'noresultzzq',
      '',
    ]) {
      const match = query
        ? sql`(${links.searchVector} @@ websearch_to_tsquery('english', ${query}) or ${core.tagSearchVector} @@ websearch_to_tsquery('english', ${query}))`
        : undefined;
      const where = core.whereLibrary(match);
      const total = await db.select({ count: sql<string>`count(*)` }).from(links).where(where);
      const sources = await db
        .select({ source: links.sourceKind, count: sql<string>`count(*)` })
        .from(links)
        .where(where)
        .groupBy(links.sourceKind);
      const tagRows = await db
        .select({ tag: tags.name, count: sql<string>`count(distinct ${links.id})` })
        .from(links)
        .innerJoin(linkTags, eq(linkTags.linkId, links.id))
        .innerJoin(tags, eq(tags.id, linkTags.tagId))
        .where(where)
        .groupBy(tags.id, tags.name)
        .orderBy(desc(sql`count(distinct ${links.id})`), asc(tags.name))
        .limit(20);
      expect(await core.countLinks({ query }), query).toEqual({
        total: Number(total[0]?.count ?? 0),
        bySource: Object.fromEntries(sources.map((row) => [row.source, Number(row.count)])),
        topTags: tagRows.map((row) => ({ tag: row.tag, count: Number(row.count) })),
      });
    }
  });

  it('preserves tag-only prefixes with stemming and parser punctuation', async () => {
    await seed();
    const core = harness.mod();
    const tags = [
      'C++',
      'up-to-date',
      'naïve',
      "o'brien",
      'generously',
      'skies',
      'john@example.com',
      'foo_bar',
      '100%',
      'βήτα',
      'foo\\bar',
    ];
    await core.createLink({ url: 'https://edge.example/one', sourceKind: 'link', tags });
    for (const query of tags.flatMap((tag) => [tag, tag.slice(0, -1)])) {
      const before = await core.runLegacyUnionSearch(
        core.whereLibrary(),
        core.tagSearchVector,
        query,
        undefined,
        { limit: 100 },
        { snippetFor: core.buildSnippetHeadline },
      );
      expect(await core.search(query, {}, { limit: 100 }), query).toEqual(before);
    }
  });

  it('keeps filtered pages and counts identical', async () => {
    await seed();
    const core = harness.mod();
    const { links, linkTags, tags, db } = await import('@silo/db');
    for (const tag of ['space', 'missing']) {
      const scope = sql`exists (select 1 from ${linkTags} join ${tags} on ${tags.id} = ${linkTags.tagId}
        where ${linkTags.linkId} = ${links.id} and ${tags.normalizedKey} = ${tag})`;
      const extraConditions = [
        sql`${links.sourceKind} = 'link'`,
        sql`${links.createdAt} >= '2026-01-01'::timestamptz`,
        sql`${links.createdAt} < '2026-01-02'::timestamptz`,
      ];
      const oldPage = await core.runLegacyUnionSearch(
        core.whereLibrary(),
        core.tagSearchVector,
        'nebula',
        scope,
        { limit: 1 },
        { extraConditions, sort: 'newest', snippetFor: core.buildSnippetHeadline },
      );
      expect(
        await core.search(
          'nebula',
          { tag, source: 'link', since: '2026-01-01', until: '2026-01-02', sort: 'newest' },
          { limit: 1 },
        ),
      ).toEqual(oldPage);
      const textMatch = sql`(${links.searchVector} @@ websearch_to_tsquery('english', 'nebula') or ${core.tagSearchVector} @@ websearch_to_tsquery('english', 'nebula'))`;
      const oldTotal = await db
        .select({ count: sql<string>`count(*)` })
        .from(links)
        .where(core.whereLibrary(textMatch, scope, ...extraConditions));
      const counted = await core.countLinks({
        query: 'nebula',
        tags: [tag, tag.toUpperCase()],
        source: 'link',
        since: '2026-01-01',
        until: '2026-01-02',
      });
      expect(counted.total).toBe(Number(oldTotal[0]?.count));
    }
  });

  it('keeps sidebar counts equal to DISTINCT across empty, trashed and feed-only tags', async () => {
    await seed();
    await harness.rawDb().execute(sql`
      insert into tags(name, normalized_key) values ('Empty', 'empty');
      insert into link_tags(link_id, tag_id) values
        (md5('equivalence10')::uuid, md5('nebula')::uuid),
        (md5('equivalence11')::uuid, md5('space')::uuid);
    `);
    const core = harness.mod();
    const { db, links, linkTags, tags } = await import('@silo/db');
    const { eq, asc, desc } = await import('drizzle-orm');
    const count = sql<string>`count(distinct ${links.id})`;
    const expected = await db
      .select({ name: tags.name, count })
      .from(tags)
      .leftJoin(linkTags, eq(linkTags.tagId, tags.id))
      .leftJoin(links, core.whereLibrary(eq(links.id, linkTags.linkId)))
      .groupBy(tags.id, tags.name)
      .orderBy(desc(count), asc(tags.name));
    expect(await core.listTagsWithCounts()).toEqual(
      expected.map((row) => ({ ...row, count: Number(row.count) })),
    );
    expect(await core.listTagsWithCounts()).toContainEqual({ name: 'Empty', count: 0 });
  });
});
