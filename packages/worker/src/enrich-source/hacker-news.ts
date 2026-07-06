/**
 * Hacker News enricher — fetches the item's public, keyless Firebase API and
 * maps it onto the `hacker_news` `SourceData` variant (source-data/
 * rich-previews slice, plan 012).
 *
 * Degrades gracefully on ANY failure (bad status, timeout, malformed JSON,
 * a deleted/dead HN item, a shape that doesn't parse) by returning
 * `undefined` — the caller (`enrich-source/index.ts`) treats that exactly
 * like "no source enrichment happened this pass": the generic capture
 * (title/description/text from `extract()`) stands untouched, and
 * `recordEnrichment`'s coalesce means nothing is overwritten. A rich-preview
 * enricher failing must NEVER fail the whole enrichment job (see
 * `enrich.ts`'s resolve-vs-throw contract).
 */

import type { SourceData } from '@silo/core';
import { sourceDataSchema } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { fetchJsonObject } from './fetch-json.js';

/** The subset of the Firebase item JSON this enricher actually reads. Every other field on a real HN item (kids, url, type, ...) is ignored. */
interface HnItemResponse {
  score?: unknown;
  descendants?: unknown;
  by?: unknown;
  /** Firebase returns a bare JSON `null` (not 404) for a nonexistent/dead item id. */
  deleted?: unknown;
  dead?: unknown;
}

/** `hacker-news.firebaseio.com`, NOT `hn.algolia.com` — the plan's explicit correction (the Algolia host is a different, unrelated search API). */
function itemUrl(itemId: number): string {
  return `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`;
}

type HackerNewsSourceData = Extract<SourceData, { kind: 'hacker_news' }>;

/**
 * Fetch + shape a Hacker News item's `SourceData`. `fetchFn` is the
 * SSRF-safe fetcher (injected so tests can stub it without a real network
 * call) — see `enrich-source/index.ts` for the production wiring.
 */
export async function enrichHackerNews(
  itemId: number,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<HackerNewsSourceData | undefined> {
  // A nonexistent item id resolves to a bare JSON `null` from Firebase — not
  // an HTTP error `safeFetch` would have already caught; `fetchJsonObject`
  // degrades that (and any other non-object body) to `undefined` for us.
  const parsed = await fetchJsonObject(itemUrl(itemId), fetchFn);
  if (parsed === undefined) return undefined;

  const item = parsed as HnItemResponse;
  if (item.deleted || item.dead) return undefined;

  const candidate = {
    kind: 'hacker_news' as const,
    points: item.score,
    comments: item.descendants ?? 0,
    author: item.by,
  };
  const shaped = sourceDataSchema.safeParse(candidate);
  return shaped.success && shaped.data.kind === 'hacker_news' ? shaped.data : undefined;
}
