import { db, links } from '@silo/db';
import { asc, desc, sql } from 'drizzle-orm';
import type { Link } from './executor.js';
import {
  decodeSearchCursor,
  effectiveLimit,
  encodeSearchCursor,
  hydrateTags,
  type LinkWithTags,
  type PageParams,
} from './pagination.js';

/**
 * Shared query-building + query-running helpers for link search
 * (search-union rework): a single query that matches a row when EITHER the
 * prefix full-text predicate OR the `pg_trgm` substring predicate is true,
 * with FTS-matching rows rank-penalized above trigram-only rows. Extracted
 * here (not inlined into `links.ts`'s `search()` and `trash.ts`'s
 * `searchTrash()`) so both callers share the EXACT same tsquery-building,
 * substring-matching, and query-assembly control flow — `search()` and
 * `searchTrash()` are already near-identical by design (see `links.ts`'s
 * `tagSearchVector` doc comment) and sit at the repo's 1.5% jscpd threshold;
 * copying this logic into both would trip it and — far worse — risk the two
 * escaping implementations silently drifting apart, which is exactly the
 * kind of bug that turns into a SQL-injection surface over time.
 *
 * Reworked from the original two-tier "trigram fallback ONLY on a page-1
 * zero-row FTS result" design (commit 5b3180f) after adversarial review
 * (verified on real Postgres, see docs/methods/search-union-rework.md) found
 * that gate structurally wrong: the two tiers cover different fields, so a
 * tag-prefix match on ONE row made the whole query's FTS tier non-empty,
 * silently suppressing legitimate trigram substring matches on OTHER rows.
 * The fix: always run both matchers UNIONed in one query (see
 * `runUnionSearch`), never gated on the other's row count.
 */

/**
 * Strip C0 control characters (U+0000 through U+001F) from a raw search
 * query — a bare NUL byte (or any other C0 control char) makes Postgres
 * throw `invalid byte sequence for encoding "UTF8": 0x00` when bound as a
 * query parameter, which otherwise surfaces as an unhandled 500 (API) / tool
 * error (MCP) rather than a normal empty/partial result. Applied ONCE, here,
 * before either `buildPrefixTsQuery` or `buildSubstringMatch` ever sees the
 * query — both builders, and everything downstream, only ever operate on
 * sanitized text.
 *
 * Only C0 controls are stripped (not, say, DEL or C1 controls) — that is the
 * documented, narrow fix for the concrete encoding-error class Postgres
 * rejects; broader input normalization is out of scope here.
 */
export function sanitizeQuery(query: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching C0 controls to strip them (see doc comment).
  return query.replaceAll(/[\u0000-\u001F]/g, '');
}

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
 * whitespace-only input) — callers must treat that as "no FTS-side match"
 * and, if `buildSubstringMatch` ALSO returns `undefined` for the same input,
 * there is nothing to match at all (see `runUnionSearch`).
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
 * method decision, search-substring D1, unchanged by the union rework):
 * `extracted_text` is bounded to 600,000 chars for the tsvector byte-clamp
 * reason documented on `links.searchVector` in the schema, and including a
 * field that large in a per-row expression index would make every
 * insert/update pay to trigram-index a huge blob for a matcher that only
 * exists to catch short substring fragments in title/description/url/notes.
 * Title/description/canonical-url/notes are the fields a personal link's
 * identifying text realistically lives in; the FTS side of the union (which
 * DOES cover extracted_text) always runs too, so nothing is lost overall.
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
 * Build the trigram-side match condition + `similarity()` ranking expression
 * for a RAW TRIMMED query. Returns `undefined` for an empty/whitespace-only
 * query (mirrors `buildPrefixTsQuery`'s empty-input contract) — callers must
 * not run the trigram side on empty input.
 *
 * `match`: `trigramText ILIKE needle ESCAPE '\'`. The `links_trgm_live_idx`
 * GIN trigram index (migration 0012) exists over this same expression and IS
 * used (a bitmap index scan) when this ILIKE predicate runs standalone. But
 * `runUnionSearch` never runs it standalone — it OR's this predicate together
 * with the FTS side in one WHERE clause (`(searchVector @@ ftsQuery OR
 * tagVector @@ ftsQuery) OR trigramText ILIKE needle`), and verified via
 * `EXPLAIN` on real Postgres (5k and 50k rows), the planner does NOT use
 * `links_trgm_live_idx` for that OR'd form — it seq-scans instead. Results
 * are still correct either way; a seq scan is an accepted tradeoff at
 * personal-store scale, not a bug, and the query is deliberately NOT
 * restructured to force index use (see `runUnionSearch`'s doc comment for why
 * the two sides stay a single unioned WHERE). The index is kept in the schema
 * regardless — it costs only insert/update-time maintenance, and remains
 * available if a future standalone trigram-only query path is added; no
 * union-level EXPLAIN test currently asserts an index scan here, so don't
 * assume one from this comment alone.
 * `similarityRank`: `similarity(trigramText, rawTrimmedQuery)` — used in the
 * composite ORDER BY's tie-break for trigram-only rows (D3: best trigram
 * match on top among rows that don't ALSO match FTS); kept clearly separate
 * from (never summed with) the FTS `combinedRank`.
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
type SqlTextOrNullFragment = ReturnType<typeof sql<string | null>>;

/** The FTS side's match/rank/tsQuery fragments, built only when the query has usable FTS tokens. */
type FtsSide = {
  tsQuery: SqlFragment;
  match: SqlFragment;
  combinedRank: SqlNumberFragment;
};

/** The trigram side's match/rank fragments, built only when the query has a non-empty trimmed body. */
type SubstringSide = {
  match: SqlFragment;
  similarityRank: SqlNumberFragment;
};

/**
 * A search result page — one row per matched link, ranked, with `rank`
 * reattached and `extractedText` stripped in favor of a query-focused
 * `snippet` (agent-navigation slice U2 — see `links.ts`'s `SearchResultRow`
 * doc comment for why the full body is dropped). This is now the SAME shape
 * as `links.ts`'s `SearchPage`/`SearchResultRow` by design, so both `search()`
 * and `searchTrash()` can return `runUnionSearch(...)`'s result directly with
 * no post-mapping.
 */
export type SearchRankedPage = {
  results: (Omit<LinkWithTags, 'extractedText'> & { rank: number; snippet: string | null })[];
  nextCursor?: string;
};

/**
 * Optional behavior grafted onto the union search (agent-navigation slices
 * U1/U2, reconciled onto the search-union rework): extra filter predicates,
 * an alternate sort, and a per-row snippet. All three default to the
 * pre-existing union-search behavior when omitted, so every caller that
 * predates this option object keeps its exact current behavior.
 */
export type UnionSearchOptions = {
  /**
   * Extra ANDed WHERE conditions (e.g. `filter.source`/`tags[]`/`since`/
   * `until` — see `links.ts`'s `search()`). ANDed in alongside
   * `basePredicate`/`unionMatch`/`scopeCondition` via the same `andAll`;
   * omitted (or empty) leaves the WHERE clause unchanged.
   */
  extraConditions?: SqlFragment[];
  /**
   * Result ordering. `'relevance'` (default) keeps the frozen composite
   * `ORDER BY` (FTS-match-first, combined `ts_rank`, then trigram
   * `similarity`). `'newest'`/`'oldest'` order by `created_at` DESC/ASC
   * instead — the union match predicate STILL filters (a row must still
   * satisfy the FTS-or-trigram match), it just stops controlling order.
   * Every ordering carries the same `links.id ASC` tiebreak (see this
   * function's doc comment) so pagination stays deterministic regardless of
   * which sort is chosen.
   */
  sort?: 'relevance' | 'newest' | 'oldest';
  /**
   * Per-row snippet builder. Receives the FTS side's `to_tsquery(...)` SQL
   * expression and must return a `SQL<string | null>` select expression
   * (e.g. `links.ts`'s `buildSnippetHeadline`). Called ONLY when the FTS
   * side is present (`ftsQueryText !== undefined`) — a trigram-only query
   * has no tsquery to build a `ts_headline` against, so the snippet column
   * is `null` in that case regardless of whether `snippetFor` is given.
   * Omitted entirely => every row's `snippet` is `null`. In a MIXED query
   * (both the FTS and trigram sides present), gated PER ROW to `null` for any
   * row that matched ONLY via the trigram side — see `resolveSnippet`'s doc
   * comment.
   */
  snippetFor?: (ftsTsQuery: SqlFragment) => SqlTextOrNullFragment;
  /**
   * When true, suppress the trigram substring side of the union entirely —
   * match ONLY via the FTS/prefix + tag-vector side. Used by `findRelated`
   * (agent-navigation U3), whose per-term topical-overlap search must NOT
   * substring-match (`ILIKE '%term%'`) non-topical fragments: a short/common
   * term like `the` would otherwise trigram-match `weather`/`together`/almost
   * every row and flood the overlap aggregation with noise. FTS is stopword-
   * aware (`to_tsquery('english','the')` is empty → matches nothing), so an
   * FTS-only search yields topical matches only. Default false (both sides run,
   * the pre-existing union behavior). When true AND the query has no usable FTS
   * tokens (e.g. a pure-stopword or empty term), the search matches nothing and
   * returns an empty page — correct for `findRelated` (a no-signal term
   * contributes no candidates), never an error.
   */
  ftsOnly?: boolean;
};

/**
 * Run the union search (search-union rework) against `basePredicate` (the
 * live-vs-trash scope: `whereLive(...)` for live search, the trashed
 * condition for `searchTrash` — the ONE thing that differs between the two
 * callers) ANDed with `tagVector` (each caller's `tagSearchVector`, passed
 * in rather than imported here to avoid a `links.ts` <-> `search-query.ts`
 * import cycle) and an optional `scopeCondition` (`search()`'s `filter.tag`
 * EXISTS clause; `searchTrash` never passes one).
 *
 * Shared by `links.ts`'s `search()` and `trash.ts`'s `searchTrash()` so the
 * query-assembly control flow exists in exactly one place.
 *
 * Match predicate (single query, no tiers, no fallback gate):
 *
 *   (searchVector @@ ftsQuery OR tagVector @@ ftsQuery) OR trigramText ILIKE needle ESCAPE '\'
 *
 * — a row matches when EITHER the prefix-FTS side (title/description/
 * extracted_text/notes via the stored `search_vector`, OR the link's tag
 * names via `tagVector`) OR the trigram substring side (title/description/
 * canonical-url/notes, see `trigramText`'s doc comment) is true. Tags
 * participate in the FTS/prefix side only — a bare mid-word substring of a
 * tag name is NOT trigram-matched (documented limitation, not a silent gap:
 * `trigramText` deliberately excludes tag names, same as it excludes
 * `extracted_text`).
 *
 * `query` is sanitized (C0 control chars stripped, `sanitizeQuery`) BEFORE
 * either builder runs — a null byte or other control char can never reach
 * Postgres as a bound parameter and throw an encoding error. If the
 * sanitized query strips to empty/whitespace, `buildPrefixTsQuery` AND
 * `buildSubstringMatch` both return `undefined` and this returns an empty
 * page without querying — the existing empty-query contract.
 *
 * If only ONE of the two builders returns a usable fragment (e.g. a query
 * that has tokens for the trigram side but strips to empty for the tsquery
 * builder, or vice versa), the missing side's disjunct is OMITTED from the
 * WHERE clause and its rank term from the ORDER BY, rather than emitting
 * invalid SQL (`... @@ undefined`) or silently treating "no FTS match" as
 * "no match at all".
 *
 * Ranking: a single composite `ORDER BY`, so FTS-matching rows (via title,
 * body, or tag) sort ABOVE trigram-only rows, are then ordered by their
 * combined `ts_rank` (title/body-vector rank + tag-vector rank), and
 * trigram-only rows are ordered among themselves by `similarity()` desc,
 * with `links.id` ASC appended as a FINAL tiebreaker:
 *
 *   ORDER BY (searchVector @@ ftsQuery OR tagVector @@ ftsQuery) DESC,
 *            (ts_rank(searchVector, ftsQuery) + ts_rank(tagVector, ftsQuery)) DESC,
 *            similarity(trigramText, rawTrimmedQuery) DESC,
 *            links.id ASC
 *
 * The `links.id ASC` term is load-bearing for pagination, not cosmetic: the
 * three rank terms above it are frequently EQUAL across multiple rows (e.g.
 * several links sharing the same matched tag/title token all get identical
 * `ts_rank`), and without a unique final term Postgres is free to return
 * those tied rows in ANY order across separate `OFFSET`-paged queries — so
 * paging through equal-rank rows could duplicate some and skip others
 * (verified on real Postgres: page 1 and page 2 overlapped before this fix).
 * `links.id` is unique and stable, so appending it makes the total order
 * deterministic and guarantees stable offset pagination over equal-rank ties.
 *
 * `rank` returned to callers stays a single `number` column: the combined
 * ts_rank for an FTS-matching row, or `similarity()` for a trigram-only row
 * (a non-comparable scale across the FTS/trigram boundary, but never
 * compared cross-boundary by a caller — only used to order WITHIN each
 * side, which the composite ORDER BY above already guarantees).
 *
 * Pagination is a plain bounded offset cursor (`{ offset }`, no tier) —
 * capped at `MAX_OFFSET` in `decodeSearchCursor` (a forged/deep offset is
 * rejected with `InvalidCursorError` rather than run, since each page past
 * that depth is a full sort-then-discard) — documented tradeoff: a row
 * inserted mid-paging can shift results, acceptable for search at this
 * scale. `limit` is clamped to `[1, 100]` (default 20) via `effectiveLimit`.
 *
 * `options` (agent-navigation slices U1/U2, grafted onto the union rework —
 * see `UnionSearchOptions`) is entirely OPTIONAL and additive:
 *   - `extraConditions` are ANDed in alongside the union match (via the same
 *     `andAll` the base predicate/scope condition already go through) —
 *     they narrow which rows match, but never change WHICH of the FTS/
 *     trigram sides is considered a "match" for ranking purposes.
 *   - `sort` swaps the ORDER BY's leading terms for `created_at` DESC/ASC
 *     when `'newest'`/`'oldest'` is requested. The union match predicate
 *     (WHERE) is UNCHANGED by `sort` — a row still has to satisfy the FTS-
 *     or-trigram match to appear at all; `sort` only stops the composite
 *     rank terms from controlling ORDER BY. `links.id ASC` remains the
 *     final tiebreak in every case (see below).
 *   - `snippetFor` attaches a per-row `snippet` column, built from the FTS
 *     side's `tsQuery` when that side exists. A trigram-only query (no FTS
 *     tokens) has no `tsQuery` to headline against, so `snippet` is `null`
 *     for every row in that case — this is a query-level fact and holds
 *     regardless of whether `snippetFor` was even given. In a MIXED query
 *     (both sides present), the snippet is ALSO gated per row to `null` for
 *     any row that matched only via the trigram side (see `resolveSnippet`).
 *   - `ftsOnly` suppresses the trigram substring side entirely (as if
 *     `buildSubstringMatch` had returned `undefined`) — see
 *     `UnionSearchOptions.ftsOnly` for why (`findRelated`'s per-term
 *     topical-overlap search must not substring-match non-topical
 *     fragments). The union collapses to FTS/tag-vector-only: the trigram
 *     disjunct is dropped from the WHERE, its rank term degrades to `0` in
 *     the ORDER BY/`rank` column, and the empty-query early-return fires
 *     whenever the FTS side ALSO has no usable tokens.
 *
 * Callers that omit `options` entirely get byte-for-byte the pre-existing
 * behavior: no extra conditions, relevance-only ordering, `snippet: null`.
 */
export async function runUnionSearch(
  basePredicate: SqlFragment,
  tagVector: SqlFragment,
  query: string,
  scopeCondition: SqlFragment | undefined,
  page: PageParams,
  options: UnionSearchOptions = {},
): Promise<SearchRankedPage> {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor !== undefined ? decodeSearchCursor(page.cursor) : undefined;
  const offset = cursor?.offset ?? 0;

  const sanitized = sanitizeQuery(query);
  const ftsQueryText = buildPrefixTsQuery(sanitized);
  // findRelated (ftsOnly) suppresses the trigram substring side — see
  // UnionSearchOptions.ftsOnly. Treat it as absent so the union collapses to
  // an FTS/tag-vector-only match (topical, stopword-aware) with no ILIKE noise.
  const substring = options.ftsOnly ? undefined : buildSubstringMatch(sanitized);

  if (ftsQueryText === undefined && substring === undefined) {
    return { results: [] };
  }

  // `ftsMatch`/`combinedRank`/`tsQuery` are only built when the FTS side has
  // usable tokens; `substring` is only built when the trigram side has a
  // non-empty trimmed query. Each half of the union is independently optional
  // so a query that strips to something usable for only ONE side never emits
  // an invalid `... @@ undefined` disjunct — the missing side's term is
  // simply left out of both the WHERE and the ORDER BY. `tsQuery` is exposed
  // on the returned object (not just closed over) so `options.snippetFor`
  // below can build a `ts_headline` against the SAME tsquery the match/rank
  // terms use, without rebuilding it from `ftsQueryText` a second time.
  const fts =
    ftsQueryText === undefined
      ? undefined
      : (() => {
          const tsQuery = sql`to_tsquery('english', ${ftsQueryText})`;
          const titleRank = sql`ts_rank(${links.searchVector}, ${tsQuery})`;
          const tagRank = sql`ts_rank(${tagVector}, ${tsQuery})`;
          return {
            tsQuery,
            match: sql`(${links.searchVector} @@ ${tsQuery} OR ${tagVector} @@ ${tsQuery})`,
            combinedRank: sql<number>`${titleRank} + ${tagRank}`,
          };
        })();

  const matchDisjuncts: SqlFragment[] = [];
  if (fts) matchDisjuncts.push(fts.match);
  if (substring) matchDisjuncts.push(substring.match);
  const unionMatch = sql.join(
    matchDisjuncts.map((d) => sql`(${d})`),
    sql` OR `,
  );

  // FTS-match-first, then combined ts_rank, then trigram similarity —
  // exactly the frozen composite ORDER BY. Each term degrades to a constant
  // `0` when its side is absent, rather than being omitted from the ORDER
  // BY entirely, so the clause's arity never depends on which side matched.
  // The constant is cast `0::float8` (NOT a bare `0`) because a bare integer
  // literal in `ORDER BY` is parsed by Postgres as an ORDINAL COLUMN
  // POSITION reference (SQL92 `ORDER BY <int>`), not a constant value —
  // `ORDER BY ..., 0 DESC, ...` throws `ORDER BY position 0 is not in select
  // list` (verified on real Postgres). This was previously unreachable: until
  // `ftsOnly` (see `UnionSearchOptions.ftsOnly`), `substring` was undefined
  // ONLY when the whole query was empty/whitespace, which already short-
  // circuits to `{ results: [] }` before this line runs — so `combinedRankTerm`
  // degrading to a bare `0` while `fts` exists never actually happened until
  // an `ftsOnly` search made `substring` undefined on a NON-empty query.
  const ftsMatchedFlag = fts ? sql`(${fts.match})` : sql`false`;
  const combinedRankTerm = fts ? fts.combinedRank : sql`0::float8`;
  const similarityTerm = substring ? substring.similarityRank : sql`0::float8`;
  // The single `rank` column returned to callers, computed PER ROW — see
  // `resolvePerRowRank`'s doc comment for why a row's rank can't be a static
  // JS-level choice of "the FTS side exists therefore every row's rank is
  // its ts_rank".
  const rank = resolvePerRowRank(fts, substring);

  // `snippet` (agent-navigation slice U2) — see `resolveSnippet`'s doc
  // comment for why a trigram-only query always gets `snippet: null`, and
  // why a mixed query additionally gates PER ROW to `null` for a row that
  // only matched via the trigram side.
  const snippet = resolveSnippet(fts, substring, options.snippetFor);

  const orderBy = resolveOrderBy(options.sort, ftsMatchedFlag, combinedRankTerm, similarityTerm);

  const rows = await db
    .select({ link: links, rank, snippet })
    .from(links)
    .where(andAll(basePredicate, unionMatch, scopeCondition, ...(options.extraConditions ?? [])))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  return toPage(rows, limit, offset);
}

/**
 * Resolve the single per-row `rank` column `runUnionSearch` selects,
 * extracted out to keep `runUnionSearch`'s cognitive complexity under the
 * repo's lint cap. Computed PER ROW (not a static JS-level choice of "the
 * FTS side exists therefore every row's rank is its ts_rank") — a row that
 * only matched via the trigram side must expose ITS similarity, not a stale
 * `0` ts_rank from a FTS predicate it never satisfied (that bug made every
 * trigram-only row's rank collapse to 0, losing the D3 "closer trigram match
 * ranks higher" ordering signal on the returned `rank` field, even though the
 * ORDER BY itself still sorted correctly). `CASE WHEN <fts predicate> THEN
 * combinedRank ELSE similarity END` mirrors the composite ORDER BY's own
 * branch: an FTS-matching row reports its combined ts_rank; everything else
 * (necessarily trigram-only, since the WHERE already requires at least one
 * side to match) reports similarity.
 */
function resolvePerRowRank(
  fts: FtsSide | undefined,
  substring: SubstringSide | undefined,
): SqlNumberFragment {
  if (fts && substring) {
    return sql<number>`case when (${fts.match}) then (${fts.combinedRank}) else (${substring.similarityRank}) end`;
  }
  if (fts) return fts.combinedRank;
  return substring?.similarityRank ?? sql<number>`0`;
}

/**
 * Resolve `runUnionSearch`'s per-row `snippet` column (agent-navigation
 * slice U2), extracted out to keep `runUnionSearch`'s cognitive complexity
 * under the repo's lint cap. Built from the FTS side's `tsQuery` when BOTH
 * the FTS side matched some tokens AND a `snippetFor` builder was given. A
 * trigram-only query has no tsquery to headline against, so `snippet` is a
 * literal SQL `null` in that case — never a guess/fallback headline built
 * from the trigram needle instead.
 *
 * A MIXED query (both sides live) can return rows that matched ONLY via the
 * trigram substring side and never via FTS — `ts_headline` against the FTS
 * tsquery yields an un-highlighted leading excerpt for those, contradicting
 * the documented "trigram-only ⇒ null snippet" invariant (that invariant
 * previously held only query-wide, not per row). Gate per row so a
 * non-FTS-matching row's snippet is genuinely `null`: `CASE WHEN
 * (fts.match) THEN (headline) ELSE null END`. When there's no substring
 * side, every matched row necessarily matched FTS, so no gate is needed —
 * the plain headline is returned as-is.
 */
function resolveSnippet(
  fts: FtsSide | undefined,
  substring: SubstringSide | undefined,
  snippetFor: ((ftsTsQuery: SqlFragment) => SqlTextOrNullFragment) | undefined,
): SqlTextOrNullFragment {
  if (!(fts && snippetFor)) return sql<string | null>`null`;
  const headline = snippetFor(fts.tsQuery);
  if (!substring) return headline;
  return sql<string | null>`case when (${fts.match}) then (${headline}) else null end`;
}

/**
 * Resolve `runUnionSearch`'s `ORDER BY` term list for `options.sort`
 * (agent-navigation slice U1, extracted out of `runUnionSearch` to keep its
 * cognitive complexity under the repo's lint cap). `'newest'`/`'oldest'`
 * order by `created_at` DESC/ASC — the union match predicate (WHERE) is
 * UNCHANGED by `sort`, a row still has to satisfy the FTS-or-trigram match to
 * be returned at all; `sort` only stops the relevance terms below from
 * controlling order. `'relevance'`/`undefined` (the default) keeps the
 * frozen composite ORDER BY: FTS-match-first, then combined `ts_rank`, then
 * trigram `similarity()`. `links.id ASC` is ALWAYS the final term, in every
 * sort mode — load-bearing for stable offset pagination (see
 * `runUnionSearch`'s doc comment): a `sort` of `'newest'`/`'oldest'` can tie
 * on `created_at` just as easily as `'relevance'` ties on rank, and without a
 * unique final tiebreak, paging through tied rows can duplicate/skip rows
 * across pages.
 */
function resolveOrderBy(
  sort: 'relevance' | 'newest' | 'oldest' | undefined,
  ftsMatchedFlag: SqlFragment,
  combinedRankTerm: SqlFragment,
  similarityTerm: SqlFragment,
): SqlFragment[] {
  if (sort === 'newest') return [desc(links.createdAt), asc(links.id)];
  if (sort === 'oldest') return [asc(links.createdAt), asc(links.id)];
  return [desc(ftsMatchedFlag), desc(combinedRankTerm), desc(similarityTerm), asc(links.id)];
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
  rows: { link: Link; rank: number; snippet: string | null }[],
  limit: number,
  offset: number,
): Promise<SearchRankedPage> {
  const hasMore = rows.length > limit;
  const page_ = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : undefined;

  const hydrated = await hydrateTags(
    db,
    page_.map((row) => row.link),
  );
  // Strip `extractedText` and attach `rank`/`snippet` here, ONCE, so both
  // callers (`search`, `searchTrash`) get the final `SearchResultRow` shape
  // directly — see `SearchRankedPage`'s doc comment for why this now equals
  // `links.ts`'s `SearchPage`/`SearchResultRow`.
  const results = hydrated.map((link, i) => {
    const { extractedText, ...rest } = link;
    return { ...rest, rank: page_[i]?.rank ?? 0, snippet: page_[i]?.snippet ?? null };
  });
  return nextCursor === undefined ? { results } : { results, nextCursor };
}
