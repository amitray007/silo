import { db, links } from '@silo/db';
import { desc, sql } from 'drizzle-orm';
import type { Link } from './executor.js';
import {
  decodeSearchCursor,
  effectiveLimit,
  encodeSearchCursor,
  hydrateTags,
  type LinkWithTags,
  type PageParams,
  type SearchTier,
} from './pagination.js';

/**
 * Shared query-building + query-running helpers for the two-tier link search
 * (search-substring method): prefix full-text search first, a `pg_trgm`
 * substring fallback when that returns zero rows. Extracted here (not
 * inlined into `links.ts`'s `search()` and `trash.ts`'s `searchTrash()`) so
 * both callers share the EXACT same tsquery-building, substring-matching,
 * and tier-selection control flow — `search()` and `searchTrash()` are
 * already near-identical by design (see `links.ts`'s `tagSearchVector` doc
 * comment) and sit at the repo's 1.5% jscpd threshold; copying this logic
 * into both would trip it and — far worse — risk the two escaping
 * implementations silently drifting apart, which is exactly the kind of bug
 * that turns into a SQL-injection surface over time.
 */

/**
 * Build a safe `to_tsquery('english', ...)` argument for PREFIX matching:
 * upgrade the LAST token of `query` to a prefix match (`sil:*` matches
 * `silo`, `silhouette`, ...), keeping every earlier token as an exact lexeme
 * ANDed together, exactly like `websearch_to_tsquery` does for multi-word
 * input.
 *
 * `to_tsquery` (unlike `websearch_to_tsquery`) THROWS on unescaped operator
 * characters (`&|!():*`) in its input — so the tsquery text is built here,
 * app-side, from a TOKENIZED and ESCAPED input, never a raw pass-through of
 * `query`:
 *
 *   1. Split `query` on whitespace, drop empty tokens (repeated spaces,
 *      leading/trailing whitespace collapse away — matches
 *      `websearch_to_tsquery`'s own tokenizing).
 *   2. Single-quote each lexeme, escaping embedded `\` (doubled, since
 *      `to_tsquery`'s literal parser also treats backslash as an escape
 *      character) THEN embedded `'` (doubled, the standard SQL-string
 *      escape) — order matters: escaping `\` first, then `'`, means the
 *      backslashes introduced by the first pass are never themselves
 *      re-escaped by the second. A lexeme like `o'brien` becomes
 *      `'o''brien'`; a lexeme containing a literal backslash can never let
 *      an attacker inject an unescaped quote via `\'`.
 *   3. Join every quoted lexeme with ` & ` (AND — every token must match,
 *      same conjunctive semantics `websearch_to_tsquery` uses for
 *      space-separated words).
 *   4. Append `:*` (prefix match) to the LAST token ONLY — the token the user
 *      is actively typing; earlier, already-complete tokens stay exact
 *      matches so `"progr am"` doesn't loosely prefix-match `am` either.
 *
 * The assembled string is still a BOUND parameter to `to_tsquery('english',
 * $1)` at the call site (via drizzle's `sql` tagged-template interpolation) —
 * this function only controls the parameter's CONTENT, never concatenates it
 * into raw SQL text. Because every lexeme is individually single-quoted,
 * `to_tsquery`'s own parser can never reinterpret query punctuation as an
 * operator: quoting is what keeps `a & b`, `!`, `(`, `)`, `:*`, `a')--`, etc.
 * from becoming anything other than literal search terms.
 *
 * Returns `undefined` when every token strips to empty (empty string,
 * whitespace-only input) — callers must treat that as "no prefix match" and
 * must NOT fall through to the trigram tier on an empty query (there is
 * nothing to substring-match either).
 */
export function buildPrefixTsQuery(query: string): string | undefined {
  const tokens = query.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;

  const escaped = tokens.map(
    (token) => `'${token.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`,
  );
  const lastIndex = escaped.length - 1;
  const withPrefix = escaped.map((lexeme, i) => (i === lastIndex ? `${lexeme}:*` : lexeme));
  return withPrefix.join(' & ');
}

/**
 * The trigram-tier text expression — MUST stay byte-identical to the
 * `links_trgm_live_idx` GIN expression index (see
 * `packages/db/src/schema/links.ts`) or the planner won't recognize an
 * `ILIKE`/`similarity()` predicate built from this as index-backed.
 *
 * Same field set `search_vector` covers, MINUS `extracted_text` (frozen
 * method decision, search-substring D1): `extracted_text` is bounded to
 * 600,000 chars for the tsvector byte-clamp reason documented on
 * `links.searchVector` in the schema, and including a field that large in a
 * per-row expression index would make every insert/update pay to
 * trigram-index a huge blob for a fallback tier that only exists to catch
 * short substring fragments in title/description/url/notes. Title/
 * description/canonical-url/notes are the fields a personal link's
 * identifying text realistically lives in; the FTS tier (which DOES cover
 * extracted_text) is always tried first and only falls back to this tier on
 * zero FTS rows.
 *
 * Uses the SAME split-canonical-url term `search_vector`'s weight-C URL
 * clause uses (see 0010_dark_microbe/0011_worthless_firestar): fragment/
 * `#unsafe-` marker stripped via `split_part`, byte-clamped via `left`, then
 * unicode-aware word-split via `regexp_replace`.
 */
const trigramText = sql`(coalesce(${links.title}, '') || ' ' || coalesce(${links.description}, '') || ' ' || regexp_replace(left(split_part(coalesce(${links.canonicalUrl}, ''), '#', 1), 4000), '[^[:alnum:]]+', ' ', 'g') || ' ' || coalesce(${links.notes}, ''))`;

/**
 * Escape a raw user query into a safe `ILIKE` needle: wraps it in `%...%`
 * (substring-anywhere match) and escapes `\` first (so the backslashes
 * introduced by the later `%`/`_` escapes are never themselves re-escaped),
 * then `%` and `_` — so a LITERAL `%` or `_` typed by the user is matched as
 * a literal character, not interpreted as an `ILIKE` wildcard. The escaped
 * needle is still a BOUND parameter — this only controls its content — and
 * is paired with `ESCAPE '\'` at the call site so Postgres knows `\` is the
 * escape character.
 */
function escapeIlikeNeedle(query: string): string {
  const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

/**
 * Build the trigram-tier match condition + `similarity()` ranking expression
 * for a RAW TRIMMED query. Returns `undefined` for an empty/whitespace-only
 * query (mirrors `buildPrefixTsQuery`'s empty-input contract) — callers must
 * not run the trigram tier on empty input.
 *
 * `match`: `trigramText ILIKE needle ESCAPE '\'`, index-backed by
 * `links_trgm_live_idx` (a bitmap index scan, see the db-level test).
 * `similarityRank`: `similarity(trigramText, rawTrimmedQuery)` — used to
 * ORDER BY desc (D3: best trigram match on top); this tier has no `ts_rank`,
 * so `similarity()` is the closest analogous "how good a match" signal, kept
 * clearly separate from (never summed with) the FTS `combinedRank`.
 */
export function buildSubstringMatch(
  query: string,
): { match: SqlFragment; similarityRank: SqlNumberFragment } | undefined {
  const trimmed = query.trim();
  if (trimmed.length === 0) return undefined;

  const needle = escapeIlikeNeedle(trimmed);
  const match = sql`${trigramText} ILIKE ${needle} ESCAPE '\\'`;
  const similarityRank = sql<number>`similarity(${trigramText}, ${trimmed})`;
  return { match, similarityRank };
}

// Local aliases for drizzle's branded `SQL`/`SQL<number>` return types, kept
// out of every signature above for readability.
type SqlFragment = ReturnType<typeof sql>;
type SqlNumberFragment = ReturnType<typeof sql<number>>;

/** A search result page — one row per matched link, ranked, with `rank` reattached. */
export type SearchRankedPage = {
  results: (LinkWithTags & { rank: number })[];
  nextCursor?: string;
};

/**
 * Run the two-tier search (search-substring method) against `basePredicate`
 * (the live-vs-trash scope: `whereLive(...)` for live search, the trashed
 * condition for `searchTrash` — the ONE thing that differs between the two
 * callers) ANDed with `tagVector` (each caller's `tagSearchVector`, passed
 * in rather than imported here to avoid a `links.ts` <-> `search-query.ts`
 * import cycle) and an optional `scopeCondition` (`search()`'s `filter.tag`
 * EXISTS clause; `searchTrash` never passes one).
 *
 * Shared by `links.ts`'s `search()` and `trash.ts`'s `searchTrash()` so the
 * tier-selection control flow — try prefix FTS, fall back to trigram ONLY on
 * a page-1 zero-row FTS result, encode which tier a cursor belongs to, keep
 * paging on that same tier — exists in exactly one place.
 *
 * Tier selection (search-substring method, frozen decisions #1/D2):
 *   - No cursor (page 1): try the prefix-FTS tier. If it returns at least
 *     one row, that tier wins for the whole paged session. If it returns
 *     ZERO rows, fall back to the trigram tier for page 1 (and every
 *     subsequent page, via the cursor's `tier` field). An empty/whitespace
 *     query (both builders return `undefined`) short-circuits to an empty
 *     page WITHOUT running the trigram tier — there is nothing to
 *     substring-match either (see `buildPrefixTsQuery`'s doc comment).
 *   - A cursor present: decode its `tier` and stay on it — never
 *     re-evaluate which tier "should" run for page 2+, so a page can't
 *     silently jump tiers mid-scroll (D2).
 *
 * Ranking: the FTS tier orders by `combinedRank` (`ts_rank` sum, unchanged
 * shape — decision #5); the trigram tier orders by `similarity()` desc (D3)
 * — a completely different, non-comparable scale, which is exactly why the
 * two tiers are never unioned/interleaved in one query.
 */
export async function runTieredSearch(
  basePredicate: SqlFragment,
  tagVector: SqlFragment,
  query: string,
  scopeCondition: SqlFragment | undefined,
  page: PageParams,
): Promise<SearchRankedPage> {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor !== undefined ? decodeSearchCursor(page.cursor) : undefined;
  const offset = cursor?.offset ?? 0;
  const pinnedTier = cursor?.tier;

  if (pinnedTier === undefined || pinnedTier === 'fts') {
    const ftsPage = await runFtsTier(
      basePredicate,
      tagVector,
      query,
      scopeCondition,
      limit,
      offset,
    );
    // Page 1 ('unresolved', no incoming cursor) with at least one FTS row:
    // this tier wins for the whole paged session. A cursor already pinned
    // to 'fts' always returns this branch's rows (possibly an empty later
    // page), regardless of row count — it must NEVER switch tiers
    // mid-scroll (D2). Only an UNPINNED zero-row result falls through.
    if (ftsPage !== undefined && (ftsPage.rows.length > 0 || pinnedTier === 'fts')) {
      return toPage(ftsPage.rows, limit, offset, 'fts');
    }
    if (ftsPage === undefined && pinnedTier === 'fts') {
      // A cursor pinned to 'fts' but the query now strips to empty (e.g. a
      // caller re-requests a later page with a different, empty query) —
      // empty page, no trigram fallback (nothing to substring-match).
      return { results: [] };
    }
    // Falls through to the trigram tier only when this was page 1
    // (unpinned) and FTS returned zero rows or had no usable tokens.
  }

  const substring = buildSubstringMatch(query);
  if (substring === undefined) {
    return { results: [] };
  }
  const { match, similarityRank } = substring;

  const rows = await db
    .select({ link: links, rank: similarityRank })
    .from(links)
    .where(andAll(basePredicate, match, scopeCondition))
    .orderBy(desc(similarityRank))
    .limit(limit + 1)
    .offset(offset);

  return toPage(rows, limit, offset, 'trgm');
}

async function runFtsTier(
  basePredicate: SqlFragment,
  tagVector: SqlFragment,
  query: string,
  scopeCondition: SqlFragment | undefined,
  limit: number,
  offset: number,
): Promise<{ rows: { link: Link; rank: number }[] } | undefined> {
  const ftsQueryText = buildPrefixTsQuery(query);
  if (ftsQueryText === undefined) return undefined;

  const tsQuery = sql`to_tsquery('english', ${ftsQueryText})`;
  const titleRank = sql`ts_rank(${links.searchVector}, ${tsQuery})`;
  const tagRank = sql`ts_rank(${tagVector}, ${tsQuery})`;
  const combinedRank = sql<number>`${titleRank} + ${tagRank}`;

  const rows = await db
    .select({ link: links, rank: combinedRank })
    .from(links)
    .where(
      andAll(
        basePredicate,
        sql`(${links.searchVector} @@ ${tsQuery} OR ${tagVector} @@ ${tsQuery})`,
        scopeCondition,
      ),
    )
    .orderBy(desc(combinedRank))
    .limit(limit + 1)
    .offset(offset);

  return { rows };
}

/** AND together a base predicate with any number of optional additional conditions. */
function andAll(base: SqlFragment, ...rest: ReadonlyArray<SqlFragment | undefined>): SqlFragment {
  const defined = rest.filter((c): c is SqlFragment => c !== undefined);
  if (defined.length === 0) return base;
  return sql`(${base}) AND ${sql.join(
    defined.map((c) => sql`(${c})`),
    sql` AND `,
  )}`;
}

async function toPage(
  rows: { link: Link; rank: number }[],
  limit: number,
  offset: number,
  tier: SearchTier,
): Promise<SearchRankedPage> {
  const hasMore = rows.length > limit;
  const page_ = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeSearchCursor(offset + limit, tier) : undefined;

  const hydrated = await hydrateTags(
    db,
    page_.map((row) => row.link),
  );
  const results = hydrated.map((link, i) => ({ ...link, rank: page_[i]?.rank ?? 0 }));
  return nextCursor === undefined ? { results } : { results, nextCursor };
}
