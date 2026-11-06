import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('bounded library search candidates (Postgres)', () => {
  const h = setupPgHarness('silo_search_candidates_test', async () => ({
    ...(await import('./links.js')),
    ...(await import('../test-support/legacy-library-search.js')),
    ...(await import('./live.js')),
  }));

  /** Inserts `count` links titled `title`; the first also carries `extra`. */
  async function seed(prefix: string, count: number, title: string, extra = '') {
    await h.rawDb().execute(sql`
      insert into links(id, url, canonical_url, title, source_kind)
      select md5(${prefix} || n)::uuid, 'https://candidate.example/' || ${prefix} || n,
        'https://candidate.example/' || ${prefix} || n,
        case when n = 1 then ${`${extra} ${title}`.trim()} else ${title} end, 'link'
      from generate_series(1, ${count}::int) n
    `);
  }

  async function tagTitled(title: string, name: string) {
    const db = h.rawDb();
    await db.execute(sql`insert into tags(name, normalized_key) values (${name}, ${name})`);
    await db.execute(sql`
      insert into link_tags(link_id, tag_id)
      select id, (select id from tags where name = ${name}) from links where title like ${`${title}%`}
    `);
  }

  function queryTexts(spy: { mock: { calls: unknown[][] } }): string[] {
    return spy.mock.calls.map((args) => {
      const config = args[0];
      return String(
        typeof config === 'object' && config !== null && 'text' in config ? config.text : config,
      );
    });
  }

  function tagScope(tag?: string) {
    return tag
      ? sql`exists (select 1 from link_tags lt join tags t on t.id = lt.tag_id
          where lt.link_id = links.id and t.normalized_key = ${tag})`
      : sql`true`;
  }

  /** Full-scan oracle for countLinks: the same match predicate with no candidate narrowing. */
  async function expectedCounts(term: string, tag?: string) {
    const core = h.mod();
    const match = sql`(search_vector @@ websearch_to_tsquery('english', ${term})
      or ${core.tagSearchVector} @@ websearch_to_tsquery('english', ${term}))`;
    const live = sql`deleted_at is null and feed_id is null and ${match} and ${tagScope(tag)}`;
    const db = h.rawDb();
    const total = await db.execute(sql`select count(*)::int as n from links where ${live}`);
    const bySource = await db.execute(
      sql`select source_kind as k, count(*)::int as n from links where ${live} group by 1`,
    );
    const topTags = await db.execute(sql`
      select t.name as tag, count(*)::int as count from links
      join link_tags lt on lt.link_id = links.id join tags t on t.id = lt.tag_id
      where ${live} group by t.id, t.name order by 2 desc, 1 asc limit 20
    `);
    return {
      total: Number(total.rows[0]?.n),
      bySource: Object.fromEntries(bySource.rows.map((r) => [String(r.k), Number(r.n)])),
      topTags: topTags.rows.map((r) => ({ tag: String(r.tag), count: Number(r.count) })),
    };
  }

  /**
   * Runs search + countLinks for `term` and checks them against the legacy union search and the
   * full-scan oracle. `stage` is 0 (no probe), 1 (cheap probe only) or 2 (share-based probe in a
   * transaction); `transaction` is whether any BEGIN was issued.
   */
  async function probeTerm(term: string, total: number, tag?: string) {
    const core = h.mod();
    // pool.query and transactions both run through Client.query on a checked-out client.
    const spy = vi.spyOn(Client.prototype, 'query');
    const actual = await core.search(term, tag ? { tag } : {}, { limit: 20 });
    const queries = queryTexts(spy);
    spy.mockRestore();
    const expected = await core.runLegacyUnionSearch(
      core.whereLibrary(),
      core.tagSearchVector,
      term,
      tag ? tagScope(tag) : undefined,
      { limit: 20 },
      { snippetFor: core.buildSnippetHeadline },
    );
    expect(actual).toEqual(expected);
    const counts = await core.countLinks({ query: term, ...(tag ? { tag } : {}) });
    expect(counts.total).toBe(total);
    expect(counts).toEqual(await expectedCounts(term, tag));
    const main = queries.find((query) => query.startsWith('select "id"'));
    expect(main).toBeDefined();
    const probes = queries.filter((query) => query.includes('matching_tags'));
    return {
      candidatePath: main?.includes('candidate_id') ?? false,
      stage: probes.some((query) => query.includes('probe_limit'))
        ? 2
        : probes.some((query) => !query.includes('select "id"'))
          ? 1
          : 0,
      transaction: queries.some((query) => /^begin/i.test(query)),
    };
  }

  it('picks candidates for terms under half the library and scans broader ones', async () => {
    // 2400 rows: scan threshold is max(512, 0.5 * 2400) = 1200 candidate hits. Candidates are
    // not distinct (the substring branch re-counts matches), so garden stays under at 2x and
    // orchard crosses on the full-text branch alone.
    await seed('garden', 400, 'garden', 'rarexyz');
    await seed('orchard', 1300, 'orchard');
    await seed('filler', 700, 'filler');
    await tagTitled('orchard', 'harvest');
    await h.rawDb().execute(sql`analyze links`);
    const cases: [string, number, boolean, number][] = [
      // term, total, candidate path, probe stage
      ['rarexyz', 1, true, 1],
      ['garden', 400, true, 2],
      ['orchard', 1300, false, 2],
      ['zzqxvw', 0, true, 1],
      ['a', 0, false, 0],
      ['ar', 0, false, 0],
    ];
    for (const [term, total, candidatePath, stage] of cases) {
      const seen = await probeTerm(term, total);
      expect(seen, term).toEqual({ candidatePath, stage, transaction: stage === 2 });
    }
    // Negated and tag-only queries must agree with the full-scan oracle too.
    const core = h.mod();
    for (const term of ['-orchard', 'garden or -filler', 'harvest']) {
      expect(await core.countLinks({ query: term }), term).toEqual(await expectedCounts(term));
    }
    // The probe's `set local enable_seqscan = off` must not leak onto pooled connections.
    const { pool } = await import('@silo/db');
    const setting = await pool.query('show enable_seqscan');
    expect(setting.rows[0]?.enable_seqscan).toBe('on');
  });

  it('keeps the 512 floor on a never-analyzed library', async () => {
    await h.rawDb().execute(sql`alter table links set (autovacuum_enabled = false)`);
    await seed('garden', 520, 'garden', 'rarexyz');
    await seed('orchard', 200, 'orchard');
    const stats = await h
      .rawDb()
      .execute(sql`select reltuples from pg_class where oid = 'links'::regclass`);
    expect(Number(stats.rows[0]?.reltuples)).toBe(-1);
    expect(await probeTerm('rarexyz', 1)).toEqual({
      candidatePath: true,
      stage: 1,
      transaction: false,
    });
    expect(await probeTerm('orchard', 200)).toEqual({
      candidatePath: true,
      stage: 1,
      transaction: false,
    });
    expect(await probeTerm('garden', 520)).toEqual({
      candidatePath: false,
      stage: 2,
      transaction: true,
    });
  });

  it('scans from a selective tag at 512+ candidates but keeps the share probe for a broad tag', async () => {
    await seed('garden', 400, 'garden', 'rarexyz');
    await seed('orchard', 1300, 'orchard');
    await seed('filler', 700, 'filler');
    const db = h.rawDb();
    // 'rare' sits on 5 garden links (selective); 'broad' on every link (over 1000).
    await db.execute(
      sql`insert into tags(name, normalized_key) values ('rare', 'rare'), ('broad', 'broad')`,
    );
    await db.execute(sql`
      insert into link_tags(link_id, tag_id)
      select id, (select id from tags where name = 'rare') from links
      where title like 'garden%' order by links.id limit 5
    `);
    await db.execute(sql`
      insert into link_tags(link_id, tag_id) select id, (select id from tags where name = 'broad') from links
    `);
    await db.execute(sql`analyze links`);
    // garden has 800 candidate hits: stage 2 would keep the candidate path, the selective tag scans.
    expect(await probeTerm('garden', 400)).toEqual({
      candidatePath: true,
      stage: 2,
      transaction: true,
    });
    expect(await probeTerm('garden', 5, 'rare')).toEqual({
      candidatePath: false,
      stage: 1,
      transaction: false,
    });
    expect(await probeTerm('garden', 400, 'broad')).toEqual({
      candidatePath: true,
      stage: 2,
      transaction: true,
    });
    // countLinks follows the same rule: no share-based transaction under a selective tag.
    const core = h.mod();
    for (const [tag, began] of [
      ['rare', false],
      ['broad', true],
    ] as const) {
      const spy = vi.spyOn(Client.prototype, 'query');
      await core.countLinks({ query: 'orchard', tag });
      const texts = queryTexts(spy);
      spy.mockRestore();
      expect(
        texts.some((text) => /^begin/i.test(text)),
        tag,
      ).toBe(began);
    }
    // A rare term under a selective tag still takes the candidate path at stage 1.
    expect(await probeTerm('rarexyz', 0, 'rare')).toMatchObject({ stage: 1 });
    // An unknown tag matches nothing and stays on the cheap stage.
    expect(await probeTerm('garden', 0, 'nosuchtag')).toMatchObject({
      stage: 1,
      transaction: false,
    });
  });
});
