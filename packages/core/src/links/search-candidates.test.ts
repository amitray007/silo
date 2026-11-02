import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('bounded library search candidates (Postgres)', () => {
  const h = setupPgHarness('silo_search_candidates_test', async () => ({
    ...(await import('./links.js')),
    ...(await import('../test-support/legacy-library-search.js')),
    ...(await import('./live.js')),
  }));

  it('keeps rare indexed matches, scans broad terms, and skips the probe for short substrings', async () => {
    await h.rawDb().execute(sql`
      insert into links(id, url, canonical_url, title, source_kind)
      select md5('candidate' || n)::uuid, 'https://candidate.example/' || n,
        'https://candidate.example/' || n,
        case when n = 1 then 'rarexyz garden' else 'garden' end, 'link'
      from generate_series(1, 600) n
    `);
    const core = h.mod();
    const { pool } = await import('@silo/db');
    for (const term of ['rarexyz', 'garden', 'a', 'ar']) {
      const spy = vi.spyOn(pool, 'query');
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
      const main = queries.find((query) => query.startsWith('select "id"'));
      expect(main).toBeDefined();
      expect(main?.includes('candidate_id')).toBe(term === 'rarexyz');
      expect(
        queries.some((query) => query.includes('limit $') && query.includes('matching_tags')),
      ).toBe(term.length >= 3);
      expect((await core.countLinks({ query: term })).total).toBe(
        term === 'rarexyz' ? 1 : term === 'garden' ? 600 : 0,
      );
    }
  });
});
