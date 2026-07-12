import { getById, type SearchResultRow, search } from './links.js';

/**
 * "Find related links" (agent-navigation slice U3) — given a seed link, return
 * OTHER live links that mechanically overlap it on tags/title terms. No AI:
 * this runs the exact same `search()` full-text + tag ranking machinery
 * `search_links` uses (see `links.ts`'s `search` doc comment), once PER seed
 * term, and aggregates the per-term result sets by overlap — see
 * `findRelated`'s doc comment for why per-term aggregation replaced a single
 * OR-joined query. Reusing `search()` (rather than a hand-rolled parallel
 * query) is what keeps this unit's SQL footprint at zero (no new tsquery/
 * ts_headline logic, no jscpd risk).
 *
 * Each per-term search runs FTS-only (`search()`'s internal `ftsOnly` opt,
 * see `links.ts`'s `SearchInternalOptions` / `search-query.ts`'s
 * `UnionSearchOptions.ftsOnly`) — topical, stopword-aware matching via the
 * `search_vector`/tag-vector side only. The union path's trigram substring
 * side (always-on `ILIKE '%term%'`) is deliberately excluded here: it is NOT
 * stopword/topical-aware, so a short/common title term like "the" would
 * otherwise substring-match `weather`/`together`/almost every row and flood
 * the overlap aggregation with noise (verified against real Postgres via
 * adversarial review of this slice). FTS's `to_tsquery('english', ...)`
 * empties out a pure-stopword term instead, contributing zero (correct)
 * candidates for it.
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
 * Build the deduped term list `findRelated` searches with, ONE AT A TIME: the
 * seed's tag names (strongest signal — a deliberately user-applied label)
 * followed by its significant title words. Deduped case-insensitively (a
 * `Set` over lowercased terms) so a title word that repeats a tag (e.g. tag
 * `rust` + title word "rust") isn't searched twice — it would otherwise
 * inflate that candidate's `matchCount` in `findRelated`'s aggregation
 * without adding real signal, since both terms would match the exact same
 * rows.
 *
 * Why per-term instead of one combined query: `search()`'s union path
 * (`buildPrefixTsQuery`) ANDs every token of a single query string together
 * (see `runUnionSearch`'s doc comment) — there is no more `websearch_to_tsquery`
 * OR-keyword to lean on for disjunction (that path is gone from `search()`,
 * see `links.ts`). Running ONE `search()` call per term instead gives true
 * OR-over-terms: a candidate need only match ONE term to surface, and
 * `findRelated` aggregates each candidate's overlap across terms itself
 * (`matchCount`) rather than relying on `search()`'s internal `ts_rank` to
 * encode "matched more terms" the way a single OR-tsquery used to. Each of
 * these per-term searches also runs FTS-only (`{ ftsOnly: true }`, see
 * `findRelated`'s doc comment) — topical, stopword-aware matching only, so
 * the trigram substring noise the union path's always-on `ILIKE` side would
 * otherwise introduce is excluded by design.
 *
 * Returns `[]` when the seed has NEITHER tags NOR any significant title word
 * — the "no signal" case `findRelated` handles by returning an empty result
 * (see its doc comment) rather than running a query that would match
 * everything.
 */
function buildRelatedSearchTerms(tags: ReadonlyArray<string>, title: string | null): string[] {
  const terms = [...tags, ...significantTitleWords(title)];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(term);
  }
  return deduped;
}

/** Per-candidate accumulator for `findRelated`'s cross-term aggregation — see
 * that function's doc comment for what `matchCount`/`rankSum` mean and how
 * they're used to sort. */
type RelatedCandidate = {
  matchCount: number;
  rankSum: number;
  row: SearchResultRow;
};

/**
 * Find other LIVE links related to `id`, ranked by mechanical term overlap.
 * Each of the seed's tags + significant title words is searched
 * INDEPENDENTLY via `search()` (one call per term — see
 * `buildRelatedSearchTerms`'s doc comment for why a single combined query no
 * longer works), and candidates are ranked by how many DISTINCT terms they
 * matched (`matchCount`, the primary overlap signal — a candidate sharing
 * BOTH of the seed's tags appears in two terms' result sets and so outranks
 * one sharing only one), with each term-search's `rank` summed
 * (`rankSum`) as a secondary tiebreak within equal overlap, and `id` as a
 * final deterministic tiebreak. The seed itself is excluded from the result
 * (never returned as "related to itself").
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
 * Each per-term `search()` call overfetches WELL beyond the final page size
 * (`PER_TERM_FETCH`, below) for two reasons: (1) excluding the seed (a
 * near-certain self-match on every one of its own terms) shouldn't under-fill
 * the final aggregated page — the seed always carries its own tags/title
 * terms and would otherwise consume one of the requested slots in EVERY
 * term's result set before being dropped; (2) a candidate sharing MANY terms
 * may still rank only mid-page within any ONE term's individual result set,
 * yet deserves a top slot overall by total overlap (`matchCount`) — a
 * shallow per-term fetch window would silently drop exactly those
 * max-overlap candidates before `findRelated` ever sees them to aggregate.
 *
 * `limit` clamped to `[1, 50]`, default 10 (`effectiveRelatedLimit`) — smaller
 * ceiling than `list`/`search`'s `[1, 100]` since this is a fixed single page,
 * not cursor-paginated; a "more like this" result set doesn't need 100 rows.
 */
export async function findRelated(id: string, limit?: number): Promise<SearchResultRow[]> {
  const effectiveLimit = effectiveRelatedLimit(limit);

  const seed = await getById(id);
  if (!seed) return [];

  const terms = buildRelatedSearchTerms(seed.tags, seed.title);
  if (terms.length === 0) return [];

  // Fetch a DEEPER window per term than the final page: a candidate sharing
  // many terms may rank only mid-page within each individual term, yet still
  // deserve a top slot by overlap (matchCount). Pulling only `limit`-ish rows
  // per term would drop exactly those max-overlap candidates. Cap the
  // per-term window so a many-term seed's fan-out stays bounded — still a
  // best-effort widening, not a hard guarantee at extreme corpus sizes, but
  // no longer drops mid-page high-overlap candidates WITHIN this window.
  // `100` mirrors search()'s own `effectiveLimit` ceiling ([1, 100]) — this
  // never asks search() for more than it would itself allow.
  const PER_TERM_FETCH = Math.min(effectiveLimit * 5, 100);

  // Sequential (not Promise.all): term counts are tiny (a handful of tags +
  // title words per link), so the marginal latency of awaiting one at a time
  // is negligible — not worth the added complexity of a parallel fan-out for
  // this bounded, small N.
  const candidates = new Map<string, RelatedCandidate>();
  for (const term of terms) {
    const { results } = await search(term, {}, { limit: PER_TERM_FETCH }, { ftsOnly: true });
    for (const row of results) {
      if (row.id === id) continue;
      const existing = candidates.get(row.id);
      if (existing) {
        existing.matchCount += 1;
        existing.rankSum += row.rank;
      } else {
        candidates.set(row.id, { matchCount: 1, rankSum: row.rank, row });
      }
    }
  }

  const sorted = [...candidates.values()].sort((a, b) => {
    if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
    if (a.rankSum !== b.rankSum) return b.rankSum - a.rankSum;
    return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
  });

  return sorted.slice(0, effectiveLimit).map((candidate) => candidate.row);
}
