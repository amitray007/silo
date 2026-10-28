/**
 * `enrichLink` — the `enrich-link` job's business logic: load the link,
 * `safeFetch` its url, `extract` structured metadata + text from the HTML,
 * and `recordEnrichment` the mapped result (plan U5, the sequence diagram in
 * the plan's "The capture -> enrich flow").
 *
 * Contract (plan R11 / Risks): this function RESOLVES on every *expected*
 * degraded-capture outcome — a blocked/dead/timed-out/oversized fetch, or a
 * thin/JS-walled/non-HTML extraction — by recording a terminal `partial`/
 * `bare` status and returning normally. Reader thread timeouts/failures and
 * unexpected failures (such as `getById`/`recordEnrichment` throwing)
 * propagate so pg-boss retries with backoff and eventually dead-letters the
 * job (see `worker.ts`).
 */

import type { EnrichJobData, ReaderExtraction, SettingsMap, SourceData } from '@silo/core';
import {
  ENRICH_ATTEMPT_CAP,
  getById,
  getSetting,
  recordEnrichment,
  recordReader,
  SETTINGS_DEFAULTS,
  settleGiveUp,
  softDelete,
} from '@silo/core';
import { enrichSource } from './enrich-source/index.js';
import type { CaptureStatus, ExtractInput, ExtractResult } from './extract/extract.js';
import { extract } from './extract/extract.js';
import { FULL_TEXT_THRESHOLD } from './extract/extract-constants.js';
import { extractYouTubeWatch } from './extract/youtube-watch.js';
import type { SafeFetchResult } from './fetch/safe-fetch.js';
import { HTML_ACCEPT, safeFetch } from './fetch/safe-fetch.js';
import { selectReader } from './reader/select-reader.js';

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
  enrichSource: (
    sourceKind: string,
    url: string,
    enabledPlugins?: SettingsMap['plugins'],
  ) => Promise<SourceData | undefined>;
  /**
   * Reads the CURRENT `plugins` toggle map (plan 017 — "enforce the toggle").
   * Defaults to the real `core.getSetting`; tests inject a stub so a toggle
   * state can be asserted without a real settings row. Read ONCE per
   * `enrichLink` call (not per source) — see the call site below.
   */
  getPluginsSetting: () => Promise<SettingsMap['plugins']>;
}

const defaultDeps: EnrichLinkDeps = {
  safeFetch: (url) => safeFetch(url, { accept: HTML_ACCEPT }),
  extract,
  // Adapter, not just a re-export: the real `enrichSource` takes its fetch
  // deps as a 3rd positional param (its own injectable seam, for ITS unit
  // tests) — `EnrichLinkDeps.enrichSource` has no such param (this module has
  // no reason to override the fetcher), so this closes over the default and
  // forwards only `enabledPlugins` in the 3rd slot `enrichSource` actually
  // expects it in.
  enrichSource: (sourceKind, url, enabledPlugins) =>
    enrichSource(sourceKind, url, undefined, enabledPlugins),
  getPluginsSetting: () => getSetting('plugins'),
};

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
 *
 * `not-found` (a true 404/410) is handled here only to keep this switch
 * exhaustive (`satisfies never`) — the worker branches on it BEFORE this
 * function is ever called (plan 025 U4: 404/410 → silent trash, never
 * recorded as a capture status), so `'bare'` is never actually observed
 * for this reason in practice.
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
    case 'not-found':
      return 'bare';
    default:
      return reason satisfies never;
  }
}

/**
 * Record an enrichment `result`, then decide whether this link has just used
 * up its last attempt (plan 025 U4 — "cap reached, still not full -> settle").
 *
 * Chosen flow (simplest correct shape, per the plan's U4 note): `recordEnrichment`
 * already increments `enrich_attempts` on every call (core, U3) and returns the
 * UPDATED row — so the post-increment count is read straight off its return
 * value, no extra query. If that count has reached `ENRICH_ATTEMPT_CAP` and the
 * just-recorded status isn't `full`, `settleGiveUp` fires immediately: a link
 * whose Nth attempt is the cap-th settles on THIS pass rather than waiting for
 * a future sweep to notice it's stuck. There is no second/"final" fetch here —
 * the plan explicitly avoids one; the cap check piggybacks on the attempt that
 * just ran. `full` is always terminal and skips this regardless of count.
 *
 * Shared by both the fetch-failure branch and the extract-success branch below
 * so the cap logic exists in exactly one place.
 */
async function recordThenMaybeSettle(
  linkId: string,
  result: Parameters<typeof recordEnrichment>[1],
): Promise<void> {
  // No downgrade: `recordEnrichment` records `full` for a run whose floor
  // (`enrich_floor_status`) is `full`, so `updated.captureStatus` is `full` here.
  const updated = await recordEnrichment(linkId, result);
  if (updated && updated.captureStatus !== 'full' && updated.enrichAttempts >= ENRICH_ATTEMPT_CAP) {
    await settleGiveUp(linkId);
  }
}

/**
 * Overrides the page's own extracted `imageUrl` with the tweet's real media
 * thumbnail when both are available (command-center polish slice). x.com's
 * own `og:image` is a useless, generic X-logo placeholder shared by every
 * tweet — not worth storing as the link's cover image — whereas the live
 * Twitter enricher's `sourceData.thumbnailUrl` (when present) is the tweet's
 * OWN media (a video's poster frame or a photo), the thing actually worth
 * showing in the card. `GET /api/preview-image` prefers `link.imageUrl` over
 * `sourceData.thumbnailUrl` (see that route's doc comment) precisely so a
 * genuinely useful `imageUrl` (GitHub's OG card, an article's hero image)
 * always wins for every OTHER source — twitter is the one case where the
 * extracted `imageUrl` is worse than the source-data alternative, so this
 * override exists here rather than by changing the proxy's general
 * preference order. A text-only tweet (no `thumbnailUrl`) or a non-twitter
 * `sourceData` leaves `extracted` untouched.
 */
function withTwitterThumbnailOverride(
  extracted: ExtractResult,
  sourceData: SourceData | undefined,
): ExtractResult {
  if (sourceData?.kind !== 'twitter' || !sourceData.thumbnailUrl) {
    return extracted;
  }
  return { ...extracted, imageUrl: sourceData.thumbnailUrl };
}

/**
 * An X post's own text for the link's extracted text, so search and MCP find
 * it. x.com serves a JavaScript shell, so the page itself yields no post text.
 * The saved post comes first, then the author's earlier thread posts, then the
 * later ones, in thread order. Empty for other sources and for empty posts.
 */
function twitterTextFields(sourceData: SourceData | undefined): { text?: string } {
  if (sourceData?.kind !== 'twitter') return {};
  const posts = [sourceData, ...(sourceData.threadBefore ?? []), ...(sourceData.threadAfter ?? [])];
  const text = posts
    .map((post) => post.text)
    .filter((part) => part.length > 0)
    .join('\n\n');
  return text.length > 0 ? { text } : {};
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
 *
 * On the extract-success branch, `withTwitterThumbnailOverride` (above)
 * replaces the page's own extracted `imageUrl` with the tweet's media
 * thumbnail (`sourceData.thumbnailUrl`) when `sourceData` is a twitter
 * result that has one — x.com's `og:image` is a generic placeholder, not
 * worth storing, so the source-specific enricher's own thumbnail wins for
 * this one source (see that function's doc comment for why this is scoped
 * to twitter rather than a general `imageUrl`-vs-`sourceData` preference
 * change).
 *
 * Plugin toggle enforcement (plan 017): the `plugins` setting is read via
 * `deps.getPluginsSetting()` ONCE per call (not once per source, and not
 * inside `enrichSource` itself, which stays a pure/no-DB dispatcher) — a
 * single settings read per job, not a hot-loop DB call. A read failure
 * (setting corrupted, database hiccup) DEGRADES to `SETTINGS_DEFAULTS
 * .plugins` (all enabled) rather than failing the job — a plugin toggle is a
 * nice-to-have UX feature; it must never be the reason a capture fails.
 * `core.getSetting` itself already degrades an invalid/missing STORED value
 * to the default, so the only failure this guards against is the read
 * itself throwing (e.g. the database being briefly unreachable).
 */

export async function enrichLink(
  linkId: string,
  deps: EnrichLinkDeps = defaultDeps,
  job?: EnrichJobData,
): Promise<void> {
  const link = await getById(linkId);
  if (!link) {
    return;
  }
  if (isFinishedRunDuplicate(link.captureStatus, job)) {
    return;
  }
  // The row decides, not the payload: `enrich_floor_status` is set by the
  // request in the same transaction and survives job loss and double clicks.
  const holdFull = link.enrichFloorStatus === 'full';

  const enabledPlugins = await deps.getPluginsSetting().catch(() => SETTINGS_DEFAULTS.plugins);

  const fetchedAt = new Date();
  const [fetchResult, enrichedSource] = await Promise.all([
    deps.safeFetch(link.url),
    // Defense in depth (reliability review): `enrichSource` is already
    // contracted never to throw (its dispatcher wraps everything in a
    // try/catch), but a best-effort rich-preview enricher must NEVER be the
    // thing that fails an otherwise-fine capture — so a second, cheap
    // `.catch` here guarantees that even a future regression in that
    // contract degrades to "no sourceData this pass" rather than propagating
    // and failing the whole `enrichLink` job.
    deps.enrichSource(link.sourceKind, link.url, enabledPlugins).catch(() => undefined),
  ]);

  const youtube =
    fetchResult.ok && link.sourceKind === 'youtube'
      ? extractYouTubeWatch(fetchResult.html, fetchResult.finalUrl)
      : undefined;
  const sourceData = youtube?.sourceData ?? enrichedSource;
  const postText = twitterTextFields(sourceData);

  // A confirmed 404/410 (plan 025 U4): the target genuinely no longer exists,
  // not merely unreachable/blocked/slow — silently trash it and stop. This is
  // terminal, so it bypasses `recordEnrichment` entirely (there is no capture
  // status to record; the link is gone). Every OTHER fetch failure (blocked,
  // rate-limited, 5xx, timeout, DNS, etc.) still flows to the existing
  // `mapSafeFetchFailureToStatus` -> `recordEnrichment` degraded path below —
  // those mean "couldn't fetch right now", not "doesn't exist".
  // A re-run of a `full` link (floor `full`) never trashes it: it takes the
  // degraded branch below and stays `full` with its old data.
  if (!fetchResult.ok && fetchResult.reason === 'not-found' && !holdFull) {
    await softDelete(linkId);
    return;
  }

  if (!fetchResult.ok) {
    await recordThenMaybeSettle(linkId, {
      status: mapSafeFetchFailureToStatus(fetchResult.reason),
      ...postText,
      ...(sourceData ? { sourceData } : {}),
    });
    return;
  }

  const extracted = withTwitterThumbnailOverride(
    await deps.extract({
      url: fetchResult.finalUrl,
      html: fetchResult.html,
      contentType: fetchResult.contentType,
    }),
    sourceData,
  );
  Object.assign(extracted, postText);

  const selected = await selectReader(link.sourceKind, extracted, youtube, {
    url: fetchResult.finalUrl,
    contentType: fetchResult.contentType,
    signal: AbortSignal.timeout(60_000),
  });
  await recordExtraction(link, extracted, selected, {
    sourceData,
    holdFull,
    fetchedAt,
  });
}

type ExtractionRecord = {
  sourceData: SourceData | undefined;
  holdFull: boolean;
  fetchedAt: Date;
};

/** Record a successful fetch + extract, including the Reader (see `enrichLink`). */
async function recordExtraction(
  link: { id: string; sourceKind: string },
  extracted: ExtractResult,
  selected: ReaderExtraction,
  { sourceData, holdFull, fetchedAt }: ExtractionRecord,
): Promise<void> {
  const linkId = link.id;
  updateRenderedStatus(extracted, selected);
  if (link.sourceKind === 'youtube') extracted.status = 'partial';
  // A held `full` link whose re-run comes back thin keeps everything it has:
  // no Reader write, and no title, description, image or text from the thin
  // result (only the source data and the status, which stays `full`).
  if (holdFull && extracted.status !== 'full') {
    await recordThenMaybeSettle(linkId, {
      status: extracted.status,
      ...(sourceData ? { sourceData } : {}),
    });
    return;
  }
  if (link.sourceKind !== 'twitter') await recordReader(linkId, selected, fetchedAt);
  const { reader: _reader, readerFailed: _readerFailed, text, ...stored } = extracted;
  // Reader writes own search text, including empty results and rejected older captures.
  await recordThenMaybeSettle(linkId, {
    ...stored,
    ...(link.sourceKind === 'twitter' && text !== undefined ? { text } : {}),
    ...(sourceData ? { sourceData } : {}),
  });
}

/**
 * A manual or sweep run always starts from `enriching` (the request sets it).
 * A job that finds another status is a duplicate of a run that already
 * finished (a second Enrich click queues a second job), so it must not run: a
 * thin result would overwrite the first run's good one. Direct calls without a
 * job context and capture-triggered jobs (a re-save of a complete link) run.
 */
function isFinishedRunDuplicate(
  status: CaptureStatus | 'enriching',
  job: EnrichJobData | undefined,
): boolean {
  return job !== undefined && job.trigger !== 'capture' && status !== 'enriching';
}

function updateRenderedStatus(extracted: ExtractResult, selected: ReaderExtraction): void {
  if (selected.status === 'reader' && selected.reader !== extracted.reader)
    extracted.status = (selected.text?.length ?? 0) >= FULL_TEXT_THRESHOLD ? 'full' : 'partial';
}
