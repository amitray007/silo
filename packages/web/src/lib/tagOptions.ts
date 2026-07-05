import type { TagCount } from '../api/types';

/** One row in a tag fly-out's option list (the row `⋯` menu's tags fly-out and the edit modal's tags picker share this shape — v3's `tagOpts`/`efTagOpts`). */
export interface TagOption {
  name: string;
  /** Whether this tag is currently assigned to the link the fly-out is open for. */
  active: boolean;
}

/** The capped option list + how many were hidden by the cap — v3's `moreTagNote` ("{n} more — type to narrow"). */
export interface TagOptionsResult {
  opts: TagOption[];
  hidden: number;
}

const OPTION_CAP = 6;

/**
 * Builds a tags fly-out's option list (plan 011, V3-4) — mirrors v3's
 * `tagOptsFor`: assigned tags sort first (so a link's current tags are always
 * visible without scrolling/filtering), then the rest in the order `allTags`
 * already arrives in (the API's `listTagsWithCounts` — most-used first),
 * filtered by the fly-out's own find-tag query (case-insensitive substring),
 * then capped to `OPTION_CAP` with the overflow reported as `hidden` so the
 * caller can render "{hidden} more — type to narrow".
 */
export function buildTagOptions(
  allTags: TagCount[],
  assignedTags: string[],
  query: string,
): TagOptionsResult {
  const q = query.trim().toLowerCase();
  const names = allTags.map((t) => t.name);
  const assignedSet = new Set(assignedTags);
  // Any assigned tag not yet in `allTags` (e.g. just-created, cache not yet
  // refetched) still needs to show as an active option — appended once.
  const allNames = [...names, ...assignedTags.filter((t) => !names.includes(t))];

  const sorted = [
    ...allNames.filter((n) => assignedSet.has(n)),
    ...allNames.filter((n) => !assignedSet.has(n)),
  ].filter((n) => !q || n.toLowerCase().includes(q));

  const capped = sorted.slice(0, OPTION_CAP);
  return {
    opts: capped.map((name) => ({ name, active: assignedSet.has(name) })),
    hidden: sorted.length - capped.length,
  };
}
