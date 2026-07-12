import type { countLinks } from '@silo/core';
import { z } from 'zod';

/**
 * Zod schema for the `since`/`until` optional date/datetime filters shared by
 * `search_links` and `list_links` (agent-navigation slice U4) — a UNION of
 * `z.iso.date()` (date-only, `YYYY-MM-DD`) and `z.iso.datetime({ offset:
 * true, local: true })` (full ISO datetime, with a trailing `Z` OR a numeric
 * timezone offset like `+05:30`) so a malformed value (`'yesterday'`,
 * `'2026-13-40'`) is rejected at the edge with a clean tool error, rather
 * than reaching `core.search`/`core.list`'s raw SQL `::timestamptz` cast,
 * which throws an unfiltered Postgres error (carried forward from the U1
 * review: garbage in `since`/`until` must never leak a raw DB error to the
 * agent).
 *
 * Fixed from a bare `.iso.datetime()` (F2, U4 adversarial review): that
 * stricter form rejected BOTH date-only input (`2026-06-01`) — including the
 * spec's own worked `since: "2026-07-01"` example — AND offset forms like
 * `2026-07-01T00:00:00+05:30`, even though Postgres's `::timestamptz` cast
 * (what `core` actually runs this string through) accepts all three shapes.
 * The union accepts exactly what `::timestamptz` accepts for these two ISO
 * families while still rejecting genuine garbage.
 *
 * Factored out once both tools' input schemas started declaring this
 * identical `.optional().describe(...)`-wrapped filter verbatim (jscpd-
 * flagged clone).
 */
export const isoDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);

/**
 * The closed set of `source_kind` values `search_links`/`list_links`'s
 * `source` filter accepts — mirrors the source kinds `detectSource` (core)
 * classifies a URL into. Shared so the two tools' `source` enum can never
 * drift from each other.
 */
export const SOURCE_KIND_VALUES = ['link', 'hacker_news', 'github', 'youtube', 'twitter'] as const;

/**
 * Shared `outputSchema` raw-shape fragment for the `count_only: true` mode's
 * fields — `total`/`bySource`/`topTags`, all `.optional()` so they coexist
 * in the same declared schema as `search_links`'s `results`/`count`/
 * `nextCursor` and `list_links`'s `links`/`count`/`nextCursor` (a
 * `count_only` result carries these three instead of the row fields — see
 * `search-links.ts`'s `searchLinksOutputShape` doc comment for the
 * one-schema-two-shapes rationale). Spread into each tool's own output shape
 * object — factored out once both tools declared this identical three-field
 * block verbatim (jscpd-flagged clone).
 */
export const countFieldsShape = {
  total: z.number().optional(),
  bySource: z.record(z.string(), z.number()).optional(),
  topTags: z.array(z.object({ tag: z.string(), count: z.number() })).optional(),
};

/**
 * Shared `content[0].text` builder for a `count_only: true` result — used by
 * both `search_links` (which has a `query` to name) and `list_links` (which
 * doesn't). `queryLabel` is the tool-specific opening clause (e.g. `match
 * "rust async"` vs. `match this filter`) so each tool's header reads
 * naturally while the source/tag breakdown lines stay identical. Factored
 * out once both tools' near-identical `toCountTextSummary` functions were
 * flagged as a jscpd clone.
 */
export function toCountTextSummary(
  queryLabel: string,
  counts: Awaited<ReturnType<typeof countLinks>>,
): string {
  const sourceParts = Object.entries(counts.bySource)
    .map(([source, count]) => `${source}: ${count}`)
    .join(', ');
  const topTagsParts = counts.topTags.map((t) => `${t.tag} (${t.count})`).join(', ');
  const lines = [`${counts.total} link${counts.total === 1 ? '' : 's'} ${queryLabel}.`];
  lines.push(sourceParts ? `By source: ${sourceParts}.` : 'By source: (none).');
  lines.push(topTagsParts ? `Top tags: ${topTagsParts}.` : 'Top tags: (none).');
  return lines.join('\n');
}
