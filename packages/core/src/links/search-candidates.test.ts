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

  /** Full-scan oracle for countLinks: the same match predicate with no candidate narrowing. */
  async function expectedCounts(term: string) {
    const core = h.mod();
    const match = sql`(search_vector @@ websearch_to_tsquery('english', ${term})
      or ${core.tagSearchVector} @@ websearch_to_tsquery('english', ${term}))`;
    const live = sql`deleted_at is null and feed_id is null and ${match}`;
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

  /** Runs search + countLinks for `term` and checks them against the legacy union search. */
  async function probeTerm(term: string, total: number) {
    const core = h.mod();
    // pool.query and transactions both run through Client.query on a checked-out client.
    const spy = vi.spyOn(Client.prototype, 'query');
    const actual = await core.search(term, {}, { limit: 20 });
    const queries = spy.mock.calls.map((args) => {
      const config: unknown = args[0];
      return String(
        typeof config === 'object' && config !== null && 'text' in config ? config.text : config,
      );
    });
    spy.mockRestore();
    const expected = await core.runLegacyUnionSearch(
      core.whereLibrary(),
      core.tagSearchVector,
      term,
      undefined,
      { limit: 20 },
      { snippetFor: core.buildSnippetHeadline },
    );
    expect(actual).toEqual(expected);
    const counts = await core.countLinks({ query: term });
    expect(counts.total).toBe(total);
    expect(counts).toEqual(await expectedCounts(term));
    const main = queries.find((query) => query.startsWith('select "id"'));
    expect(main).toBeDefined();
    return {
      candidatePath: main?.includes('candidate_id') ?? false,
      probed: queries.some(
        (query) => query.includes('probe_limit') && query.includes('matching_tags'),
      ),
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
    const cases: [string, number, boolean, boolean][] = [
      // term, total, candidate path, probe runs
      ['rarexyz', 1, true, true],
      ['garden', 400, true, true],
      ['orchard', 1300, false, true],
      ['a', 0, false, false],
      ['ar', 0, false, false],
    ];
    for (const [term, total, candidatePath, probed] of cases) {
      expect(await probeTerm(term, total), term).toEqual({ candidatePath, probed });
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
    expect(await probeTerm('rarexyz', 1)).toEqual({ candidatePath: true, probed: true });
    expect(await probeTerm('orchard', 200)).toEqual({ candidatePath: true, probed: true });
    expect(await probeTerm('garden', 520)).toEqual({ candidatePath: false, probed: true });
  });
});
