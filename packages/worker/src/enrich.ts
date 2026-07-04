/**
 * `enrichLink` — the `enrich-link` job's business logic: load the link,
 * `safeFetch` its url, `extract` structured metadata + text from the HTML,
 * and `recordEnrichment` the mapped result (plan U5, the sequence diagram in
 * the plan's "The capture -> enrich flow").
 *
 * Contract (plan R11 / Risks): this function RESOLVES on every *expected*
 * degraded-capture outcome — a blocked/dead/timed-out/oversized fetch, or a
 * thin/JS-walled/non-HTML extraction — by recording a terminal `partial`/
 * `bare` status and returning normally. It THROWS only for a genuinely
 * unexpected failure (e.g. `getById`/`recordEnrichment` itself throwing —
 * a real infra/db problem), which is exactly the signal pg-boss's
 * `work()` needs to retry with backoff and eventually dead-letter (see
 * `worker.ts`). A degraded capture is not a bug; an unreachable database is.
 */

import { getById, recordEnrichment } from '@silo/core';
import type { CaptureStatus, ExtractInput, ExtractResult } from './extract/extract.js';
import { extract } from './extract/extract.js';
import type { SafeFetchResult } from './fetch/safe-fetch.js';
import { safeFetch } from './fetch/safe-fetch.js';

/** Injectable seams for testing — default to the real implementations. */
export interface EnrichLinkDeps {
  safeFetch: (url: string) => Promise<SafeFetchResult>;
  extract: (input: ExtractInput) => Promise<ExtractResult>;
}

const defaultDeps: EnrichLinkDeps = { safeFetch, extract };

/**
 * Map a `safeFetch` failure reason to a terminal capture status (plan R10/
 * R11 — "map the safeFetch reason sensibly + document"):
 *
 * - `bare`: nothing was ever retrieved to look at — a blocked/unsafe target,
 *   unresolvable DNS, or a hard HTTP error. There is no partial signal to
 *   preserve here beyond what the link already had.
 * - `partial`: the target answered enough to prove it's a real, reachable
 *   resource (timeout mid-transfer, an oversized body we deliberately capped,
 *   too many redirects) — treated as a soft/thin capture rather than "this
 *   URL is dead", since a retry has a real chance of succeeding once the
 *   resource responds more cooperatively.
 *
 * Both are retryable (see `recordEnrichment`'s RETRYABLE_STATUSES) — the
 * distinction is about honesty of what silo actually captured, not about
 * whether a future retry is allowed.
 */
function mapSafeFetchFailureToStatus(
  reason: Exclude<SafeFetchResult, { ok: true }>['reason'],
): CaptureStatus {
  switch (reason) {
    case 'timeout':
    case 'body-too-large':
    case 'too-many-redirects':
      return 'partial';
    case 'blocked-scheme':
    case 'blocked-ip':
    case 'dns-error':
    case 'http-error':
    case 'fetch-error':
      return 'bare';
    default:
      return reason satisfies never;
  }
}

/**
 * Run the enrichment pipeline for `linkId`: fetch -> extract -> record.
 *
 * If the link no longer exists (deleted between enqueue and processing —
 * plan U4's live-scoping means `recordEnrichment` would be a no-op anyway),
 * this resolves immediately without fetching anything; there is nothing left
 * to enrich, and pg-boss should treat a vanished target as a normal
 * completion, not a failure to retry.
 */
export async function enrichLink(
  linkId: string,
  deps: EnrichLinkDeps = defaultDeps,
): Promise<void> {
  const link = await getById(linkId);
  if (!link) {
    return;
  }

  const fetchResult = await deps.safeFetch(link.url);

  if (!fetchResult.ok) {
    await recordEnrichment(linkId, { status: mapSafeFetchFailureToStatus(fetchResult.reason) });
    return;
  }

  const extracted = await deps.extract({
    url: fetchResult.finalUrl,
    html: fetchResult.html,
    contentType: fetchResult.contentType,
  });

  await recordEnrichment(linkId, extracted);
}
