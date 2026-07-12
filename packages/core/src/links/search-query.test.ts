import { beforeAll, describe, expect, it } from 'vitest';
import type * as SearchQuery from './search-query.js';

/**
 * Pure unit tests (no Postgres queries run) for the two safety-critical
 * query builders the search-substring method's escaping discipline hinges
 * on. `buildPrefixTsQuery`/`buildSubstringMatch` are exported specifically
 * so both `links.ts`'s `search()` and `trash.ts`'s `searchTrash()` share ONE
 * implementation (see `search-query.ts`'s module doc comment) — these tests
 * exercise them directly, in addition to (not instead of) the end-to-end
 * adversarial coverage in `links.test.ts`/`trash.test.ts`, which proves the
 * escaped output actually round-trips through real Postgres without error.
 *
 * `search-query.ts` imports `@silo/db`'s pooled `db` singleton at module
 * scope (needed by `runTieredSearch`, untested here), and that module
 * throws eagerly if `DATABASE_URL` is unset at IMPORT time (see
 * `@silo/db`'s `client.ts`) — so, exactly like `pg-harness.ts`'s dynamic
 * `import()` pattern, the module under test is loaded via a dynamic
 * `import()` inside `beforeAll`, AFTER a placeholder `DATABASE_URL` is set,
 * rather than a static top-level import (which vitest hoists ahead of any
 * env-var write). No real connection is ever opened — `pg.Pool`'s
 * constructor doesn't connect eagerly — so a placeholder value is
 * sufficient; nothing here executes a query.
 *
 * A drizzle `sql` template's `queryChunks` alternate `StringChunk` (the
 * literal SQL text) and bound parameter VALUES — inspecting them here proves
 * the assembled tsquery/needle text is passed as a bound parameter's VALUE,
 * never spliced into the literal SQL text.
 */

let buildPrefixTsQuery: typeof SearchQuery.buildPrefixTsQuery;
let buildSubstringMatch: typeof SearchQuery.buildSubstringMatch;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://placeholder-unused/placeholder';
  const mod = await import('./search-query.js');
  buildPrefixTsQuery = mod.buildPrefixTsQuery;
  buildSubstringMatch = mod.buildSubstringMatch;
});

function boundParams(fragment: { queryChunks: unknown[] }): unknown[] {
  return fragment.queryChunks.filter(
    (chunk) => typeof chunk !== 'object' || chunk === null || !('value' in chunk),
  );
}

describe('buildPrefixTsQuery', () => {
  it('a single word becomes a prefix-only query', () => {
    expect(buildPrefixTsQuery('sil')).toBe("'sil':*");
  });

  it('multiple words: every earlier token is exact, only the LAST token gets :*', () => {
    expect(buildPrefixTsQuery('hello wor')).toBe("'hello' & 'wor':*");
  });

  it('collapses repeated whitespace and trims leading/trailing whitespace', () => {
    expect(buildPrefixTsQuery('  hello   world  ')).toBe("'hello' & 'world':*");
  });

  it('escapes an embedded single quote by doubling it', () => {
    expect(buildPrefixTsQuery("o'brien")).toBe("'o''brien':*");
  });

  it('escapes an embedded backslash by doubling it', () => {
    expect(buildPrefixTsQuery('a\\b')).toBe("'a\\\\b':*");
  });

  it('escapes backslash BEFORE quote so a lexeme cannot forge an unescaped quote', () => {
    // If escaping order were reversed (quote-first), a lexeme ending in `\'`
    // could produce an unescaped trailing quote in the assembled tsquery
    // text. Escaping `\` first means any `\` introduced by quote-doubling
    // is never itself re-escaped, and the final output always has balanced,
    // safely-doubled quotes.
    const built = buildPrefixTsQuery("a\\'b");
    expect(built).toBe("'a\\\\''b':*");
  });

  it('operator characters (&|!():*) are inert — quoted as literal lexeme text, not parsed as operators', () => {
    // 'a & b' splits on whitespace into THREE tokens ('a', '&', 'b'), each
    // individually quoted as a literal lexeme — '&' is inert text here, not
    // the tsquery AND operator (which only the UNQUOTED ` & ` joiner below
    // between lexemes represents).
    expect(buildPrefixTsQuery('a & b')).toBe("'a' & '&' & 'b':*");
    expect(buildPrefixTsQuery('!')).toBe("'!':*");
    expect(buildPrefixTsQuery('(')).toBe("'(':*");
    expect(buildPrefixTsQuery(')')).toBe("')':*");
    expect(buildPrefixTsQuery(':*')).toBe("':*':*");
    expect(buildPrefixTsQuery("a')--")).toBe("'a'')--':*");
  });

  it('returns undefined for an empty string', () => {
    expect(buildPrefixTsQuery('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only input', () => {
    expect(buildPrefixTsQuery('   ')).toBeUndefined();
  });

  it('handles a unicode word without throwing, prefix-tagging it like any other token', () => {
    expect(buildPrefixTsQuery('ключ')).toBe("'ключ':*");
  });
});

describe('buildSubstringMatch', () => {
  it('returns undefined for an empty string', () => {
    expect(buildSubstringMatch('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only input', () => {
    expect(buildSubstringMatch('   ')).toBeUndefined();
  });

  it('wraps the trimmed query in % wildcards as a bound parameter, not spliced into SQL text', () => {
    const result = buildSubstringMatch('  silo  ');
    expect(result).toBeDefined();
    if (result === undefined) return;
    const params = boundParams(result.match);
    expect(params).toContain('%silo%');
  });

  it('escapes a literal % in the query so it is not treated as an ILIKE wildcard', () => {
    const result = buildSubstringMatch('50%');
    expect(result).toBeDefined();
    if (result === undefined) return;
    const params = boundParams(result.match);
    expect(params).toContain('%50\\%%');
  });

  it('escapes a literal _ in the query so it is not treated as an ILIKE single-char wildcard', () => {
    const result = buildSubstringMatch('a_b');
    expect(result).toBeDefined();
    if (result === undefined) return;
    const params = boundParams(result.match);
    expect(params).toContain('%a\\_b%');
  });

  it('escapes a literal backslash before escaping % and _ (order matters)', () => {
    const result = buildSubstringMatch('a\\b');
    expect(result).toBeDefined();
    if (result === undefined) return;
    const params = boundParams(result.match);
    expect(params).toContain('%a\\\\b%');
  });

  it('never throws on operator-laden or malformed input', () => {
    const adversarialQueries = ["'", '\\', 'a & b', '!', '(', ')', ':*', "a')--", 'ключ'];
    for (const query of adversarialQueries) {
      expect(() => buildSubstringMatch(query)).not.toThrow();
    }
  });
});
