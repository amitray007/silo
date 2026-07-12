import { getById, type SearchResultRow, search } from './links.js';

/**
 * "Find related links" (agent-navigation slice U3) — given a seed link, return
 * OTHER live links that mechanically overlap it on tags/title terms. No AI:
 * this is a seeded `search()` call, reusing the exact same full-text + tag
 * ranking machinery `search_links` uses (see `links.ts`'s `search` doc
 * comment) rather than a hand-rolled parallel query — sharing that query is
 * what keeps this unit's SQL footprint at zero (no new tsquery/ts_headline
 * logic, no jscpd risk).
 */

/** Default/cap for `findRelated`'s result count — mirrors `effectiveLimit`'s
 * clamp-don't-throw style elsewhere in this package for caller-supplied paging
 * numbers, but expressed locally since `findRelated` isn't itself paginated
 * (it always returns a single bounded page, no cursor). */
const DEFAULT_RELATED_LIMIT = 10;
const MAX_RELATED_LIMIT = 50;
const MIN_RELATED_LIMIT = 1;

/** Clamp `limit` into `[1, 50]`, defaulting to 10 — same clamp-don't-throw posture as `effectiveLimit`. */
function effectiveRelatedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RELATED_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), MIN_RELATED_LIMIT), MAX_RELATED_LIMIT);
}

/**
 * A seed link's title, broken into "significant" words for the term-overlap
 * query: lowercased, stripped of punctuation, deduplicated, and filtered to
 * words of length > 2 (drops "a", "an", "of", "to", ... without needing a full
 * stopword list — short function words rarely carry topical signal and this
 * keeps the term-extraction mechanical, matching the "no AI, mechanical
 * overlap" contract). Not exported: an internal helper of `findRelated`'s
 * query-building step only.
 */
function significantTitleWords(title: string | null): string[] {
  if (!title) return [];
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
  return [...new Set(words)];
}

/**
 * Build the `websearch_to_tsquery`-friendly term string `findRelated` searches
 * with: the seed's tag names (strongest signal — a deliberately user-applied
 * label) followed by its significant title words, joined with the LITERAL
 * `OR` keyword `websearch_to_tsquery` recognizes for disjunction.
 *
 * IMPORTANT: bare space-separated terms are NOT ORed by `websearch_to_tsquery`
 * — they're ANDed (`websearch_to_tsquery('english', 'rust programming')` ->
 * `'rust' & 'program'`), same as a plain multi-word web search box requiring
 * every word. An AND-joined query here would only match a candidate carrying
 * EVERY seed term, which is far too narrow for "related" (a link sharing just
 * one of several tags should still surface). Explicit ` OR ` between each
 * term (`websearch_to_tsquery('english', 'rust OR programming')` ->
 * `'rust' | 'program'`) is what makes ANY term match, so a candidate matching
 * MORE terms ranks higher via `search()`'s existing `ts_rank` — exactly the
 * "rank by overlap" the spec asks for, with zero new ranking logic.
 *
 * Returns `''` (falsy) when the seed has NEITHER tags NOR any significant
 * title word — the "no signal" case `findRelated` handles by returning an
 * empty result (see its doc comment) rather than running a query that would
 * match everything.
 */
function buildRelatedQueryTerms(tags: ReadonlyArray<string>, title: string | null): string {
  const terms = [...tags, ...significantTitleWords(title)];
  return terms.join(' OR ').trim();
}

/**
 * Find other LIVE links related to `id`, ranked by mechanical term overlap —
 * the seed's tags + significant title words become a `search()` query, and
 * `search()`'s existing combined `ts_rank` (title/description/text vector OR
 * tag-name vector) does the ranking. The seed itself is excluded from the
 * result (never returned as "related to itself").
 *
 * Documented edge-case behavior (spec: "decide + document"):
 * - **Seed id not found** (unknown id, or the seed is trashed — `getById` is
 *   live-scoped): returns `[]`. A missing seed carries no signal to search
 *   with, and an empty array is a clean, unambiguous "nothing to relate"
 *   result for an agent to branch on (vs. throwing, which would treat a
 *   plain not-found the same as a real error).
 * - **Seed has NO tags AND no significant title words** (e.g. an untagged
 *   link with an empty/very short title): also returns `[]` — there is no
 *   mechanical signal to search with, and running `search('')`/a
 *   near-empty query would either match nothing useful or (worse) rank
 *   arbitrarily. Silo never invents a semantic query, so "no signal" means
 *   "no related links," not a fallback to something arbitrary.
 *
 * Overfetches (`limit + 1` extra, capped) from `search()` before filtering out
 * the seed and truncating to `limit` — the seed itself is a strong self-match
 * (it always carries its own tags/title terms) and will otherwise consume one
 * of the requested slots before being dropped, silently under-filling the
 * page by one for a common case. `search()`'s own default relevance ordering
 * is kept (unchanged `sort` behavior) since overlap = relevance here.
 *
 * `limit` clamped to `[1, 50]`, default 10 (`effectiveRelatedLimit`) — smaller
 * ceiling than `list`/`search`'s `[1, 100]` since this is a fixed single page,
 * not cursor-paginated; a "more like this" result set doesn't need 100 rows.
 */
export async function findRelated(id: string, limit?: number): Promise<SearchResultRow[]> {
  const effectiveLimit = effectiveRelatedLimit(limit);

  const seed = await getById(id);
  if (!seed) return [];

  const queryTerms = buildRelatedQueryTerms(seed.tags, seed.title);
  if (!queryTerms) return [];

  // Overfetch by one extra page slot so excluding the seed (a near-certain
  // self-match) doesn't under-fill the final page — see doc comment above.
  const { results } = await search(queryTerms, {}, { limit: effectiveLimit + 1 });

  return results.filter((row) => row.id !== id).slice(0, effectiveLimit);
}
