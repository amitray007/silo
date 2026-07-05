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

import type { SourceData } from '@silo/core';
import { getById, recordEnrichment } from '@silo/core';
import { enrichSource } from './enrich-source/index.js';
import type { CaptureStatus, ExtractInput, ExtractResult } from './extract/extract.js';
import { extract } from './extract/extract.js';
import type { SafeFetchResult } from './fetch/safe-fetch.js';
import { safeFetch } from './fetch/safe-fetch.js';

/** Injectable seams for testing — default to the real implementations. */
export interface EnrichLinkDeps {
  safeFetch: (url: string) => Promise<SafeFetchResult>;
  extract: (input: ExtractInput) => Promise<ExtractResult>;
  /**
   * The per-source rich-preview enricher (HN/GitHub/YouTube — source-data/
   * rich-previews slice, plan 012), run for every link regardless of the
   * generic fetch/extract outcome (see `enrichLink`'s call site below for
   * why). Defaults to the real dispatcher; tests inject a stub so the HN/
   * GitHub/YouTube network calls never actually run.
   */
  enrichSource: (sourceKind: string, url: string) => Promise<SourceData | undefined>;
}

const defaultDeps: EnrichLinkDeps = { safeFetch, extract, enrichSource };

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
 *
 * Source enrichment (source-data/rich-previews slice, plan 012) runs
 * INDEPENDENTLY of the generic fetch/extract outcome, on both the success AND
 * failure branches below: an HN/GitHub/YouTube URL is enriched via that
 * source's OWN API (Firebase/REST/oEmbed), a completely separate endpoint
 * from the page's own HTML — a generic fetch failure (the target site is
 * slow/blocked/oversized) says nothing about whether the source's API is
 * reachable, and vice versa. `deps.enrichSource` already never throws (see
 * its own contract) and returns `undefined` for a `'link'`/unrecognized kind
 * or any failure, so it's always safe to fold into `recordEnrichment`'s
 * optional `sourceData` field — a degraded/absent result simply omits it,
 * and the coalesce write leaves any existing `source_data` untouched.
 *
 * The generic `safeFetch` and the source-API `enrichSource` hit UNRELATED
 * hosts with no data dependency between them, so they run CONCURRENTLY
 * (`Promise.all`) — the per-job wall-clock cost is the slower of the two
 * (~one fetch timeout), not their sum. Both sides resolve rather than throw
 * for every expected failure, so `Promise.all` never rejects on an expected
 * degraded outcome; a genuinely unexpected throw (an infra bug) from either
 * still propagates for pg-boss to retry, exactly as before.
 */
export async function enrichLink(
  linkId: string,
  deps: EnrichLinkDeps = defaultDeps,
): Promise<void> {
  const link = await getById(linkId);
  if (!link) {
    return;
  }

  const [fetchResult, sourceData] = await Promise.all([
    deps.safeFetch(link.url),
    // Defense in depth (reliability review): `enrichSource` is already
    // contracted never to throw (its dispatcher wraps everything in a
    // try/catch), but a best-effort rich-preview enricher must NEVER be the
    // thing that fails an otherwise-fine capture — so a second, cheap
    // `.catch` here guarantees that even a future regression in that
    // contract degrades to "no sourceData this pass" rather than propagating
    // and failing the whole `enrichLink` job.
    deps.enrichSource(link.sourceKind, link.url).catch(() => undefined),
  ]);

  if (!fetchResult.ok) {
    await recordEnrichment(linkId, {
      status: mapSafeFetchFailureToStatus(fetchResult.reason),
      ...(sourceData ? { sourceData } : {}),
    });
    return;
  }

  const extracted = await deps.extract({
    url: fetchResult.finalUrl,
    html: fetchResult.html,
    contentType: fetchResult.contentType,
  });

  await recordEnrichment(linkId, { ...extracted, ...(sourceData ? { sourceData } : {}) });
}
