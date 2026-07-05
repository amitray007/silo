/**
 * The per-source enrichment dispatcher — the one thing `enrich.ts` calls
 * after the generic `extract()` step (source-data/rich-previews slice, plan
 * 012). Re-runs `detectSource` on the link's own stored `url` to recover the
 * parsed itemId/owner+repo/videoId (the link's persisted `sourceKind` string
 * says WHICH enricher to run; `detectSource` recovers the typed params that
 * classification needs — cheaper and simpler than threading parsed params
 * through the job payload, and always in sync with the url actually stored).
 *
 * Contract (mirrors every enricher below): NEVER throws. A failure anywhere
 * in this module (network, parse, rate-limit, an unsupported/mismatched
 * sourceKind) resolves to `undefined` — "no source enrichment this pass" —
 * so `enrichLink` can unconditionally fold the result into its
 * `recordEnrichment` call without a try/catch of its own. A best-effort
 * rich-preview enricher must never fail (or even partially degrade) the
 * generic capture (plan R11's resolve-vs-throw contract in `enrich.ts`).
 */

import type { SourceData } from '@silo/core';
import { detectSource } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { safeFetch } from '../fetch/safe-fetch.js';
import { enrichGitHub } from './github.js';
import { enrichHackerNews } from './hacker-news.js';
import { enrichYouTube } from './youtube.js';

/** Injectable seam for testing — defaults to the real `safeFetch`. */
export interface EnrichSourceDeps {
  fetchFn: (url: string) => Promise<SafeFetchResult>;
}

const defaultDeps: EnrichSourceDeps = { fetchFn: safeFetch };

/**
 * Run the matching per-source enricher for `link`'s `sourceKind`/`url`, or
 * resolve `undefined` for `'link'`/an unrecognized kind, or on ANY failure.
 */
export async function enrichSource(
  sourceKind: string,
  url: string,
  deps: EnrichSourceDeps = defaultDeps,
): Promise<SourceData | undefined> {
  try {
    const detected = detectSource(url);
    if (detected.kind !== sourceKind) {
      // The stored sourceKind and what the url currently detects as have
      // diverged (e.g. a caller explicitly set a kind detectSource wouldn't
      // derive) — degrade rather than enrich against a mismatched parse.
      return undefined;
    }

    switch (detected.kind) {
      case 'hacker_news':
        return await enrichHackerNews(detected.itemId, deps.fetchFn);
      case 'github':
        // GitHub's API requires a non-empty User-Agent on every request —
        // `deps.fetchFn` (in production, `safeFetch`) already sends a fixed,
        // identifying one on every call (see fetch/safe-fetch.ts's
        // module-level USER_AGENT), which is all GitHub's API actually
        // checks for (presence, not a specific value) — no extra header
        // plumbing needed here.
        return await enrichGitHub(detected.owner, detected.repo, deps.fetchFn);
      case 'youtube':
        return await enrichYouTube(detected.videoId, deps.fetchFn);
      case 'link':
        return undefined;
      default:
        return detected satisfies never;
    }
  } catch {
    // Defense in depth: even though every enricher above is itself
    // contracted to never throw, a genuinely unexpected error here (e.g. a
    // future enricher added without that discipline) must still degrade
    // rather than propagate — a rich-preview enrichment failing can never
    // fail the whole capture.
    return undefined;
  }
}
