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

import type {
  EnrichJobData,
  LinkSummaryWithTags,
  ReaderExtraction,
  SettingsMap,
  SourceData,
} from '@silo/core';
import {
  ENRICH_ATTEMPT_CAP,
  getById,
  getSetting,
  recordEnrichment,
  recordReader,
  SETTINGS_DEFAULTS,
  settleGiveUp,
  softDelete,
  sourceDataSchema,
} from '@silo/core';
import type { AiRunResult } from './ai/run.js';
import { runAiFeature } from './ai/run.js';
import { planEnrich } from './enrich-plan.js';
import { enrichSource } from './enrich-source/index.js';
import { xPostTitle } from './enrich-source/twitter-title/index.js';
import type { XPostTitleInput } from './enrich-source/twitter-title/prompt.js';
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
  selectReader?: typeof selectReader;
  /**
   * Asks the optional AI layer for an X post's title (`x-post-title`). Never
   * throws; `off` means AI or the feature is off. Defaults to the real runner;
   * tests inject a stub that counts calls.
   */
  runXPostTitle?: (
    post: XPostTitleInput,
    abortSignal?: AbortSignal,
  ) => Promise<AiRunResult<string>>;
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
  runXPostTitle: (post, abortSignal) => runAiFeature(xPostTitle, post, { abortSignal }),
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

type TwitterData = Extract<SourceData, { kind: 'twitter' }>;

/**
 * The AI title rules (docs/methods/ai-x-titles.md, "When the worker asks for an
 * AI title"): a twitter post with text, a title the owner has not edited, and
 * either a page-written title or an owner-started run. A sweep or a re-save
 * never replaces a title the AI already wrote. The feature gate (AI on, feature
 * on, provider ready) lives in `runAiFeature`, so it costs no network call.
 */
function aiTitleInput(
  link: { sourceKind: string; titleSource: 'page' | 'ai' | 'user' },
  sourceData: SourceData | undefined,
  job: EnrichJobData | undefined,
): XPostTitleInput | undefined {
  if (link.sourceKind !== 'twitter' || sourceData?.kind !== 'twitter') return undefined;
  if (link.titleSource === 'user') return undefined;
  if (link.titleSource !== 'page' && job?.trigger !== 'manual') return undefined;
  const text = sourceData.text.trim();
  if (text.length === 0) return undefined;
  const post: TwitterData = sourceData;
  return {
    authorName: post.authorName,
    authorHandle: post.authorHandle,
    language: post.language,
    text,
    thread: (post.threadAfter ?? []).map((later) => later.text.trim()).filter((t) => t.length > 0),
  };
}

/**
 * Starts the AI title call and resolves to the title, or `undefined` when AI is
 * off, fails or runs out of time. Never rejects. The race adds a hard stop at the
 * feature's own budget, so a stuck call cannot hold a capture longer.
 */
async function startAiTitle(
  input: XPostTitleInput,
  run: NonNullable<EnrichLinkDeps['runXPostTitle']>,
  controller: AbortController,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const budget = new Promise<undefined>((resolve) => {
    onAbort = () => {
      clearTimeout(timer);
      resolve(undefined);
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => controller.abort(), xPostTitle.timeoutMs);
    timer.unref();
  });
  try {
    const call = run(input, controller.signal).then(
      (result) => (result.ok ? result.value : undefined),
      () => undefined,
    );
    return await Promise.race([call, budget]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

/** The title fields of a recorded result: the AI title with its source, or nothing. */
function aiTitleFields(aiTitle: string | undefined): { title?: string; titleSource?: 'ai' } {
  return aiTitle === undefined ? {} : { title: aiTitle, titleSource: 'ai' };
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
  if (isFinishedSweepDuplicate(link.captureStatus, job)) {
    return;
  }
  const plan = planEnrich(link);
  if (plan !== null) {
    await enrichSelectedFields(link, plan, deps);
    return;
  }
  await enrichFullLink(link, deps, job);
}

async function enrichFullLink(
  link: LinkSummaryWithTags,
  deps: EnrichLinkDeps,
  job: EnrichJobData | undefined,
): Promise<void> {
  const linkId = link.id;
  // The row decides, not the payload. A run is held at `full` when its floor
  // (`enrich_floor_status`, set by the owner's Enrich request) is `full`, or
  // when the link is already `full` at job start (a re-save of a complete link,
  // or a second job after the first run finished). `recordEnrichment` only sees
  // the floor, so a held run passes `status: 'full'` itself.
  const holdFull = link.enrichFloorStatus === 'full' || link.captureStatus === 'full';

  const enabledPlugins = await deps.getPluginsSetting().catch(() => SETTINGS_DEFAULTS.plugins);

  const fetchedAt = new Date();
  // The source call is awaited by the AI title start and by the join below, so the
  // AI call begins the moment the post text arrives, in parallel with the page
  // fetch, extraction and the Reader. It is awaited once, before recording.
  const sourcePromise = deps.enrichSource(link.sourceKind, link.url, enabledPlugins);
  const aiController = new AbortController();
  const runXPostTitle = deps.runXPostTitle ?? defaultDeps.runXPostTitle;
  const aiTitlePromise: Promise<string | undefined> = sourcePromise
    .catch(() => undefined)
    .then((source) => {
      if (aiController.signal.aborted) return undefined;
      const input = aiTitleInput(link, source, job);
      return input && runXPostTitle ? startAiTitle(input, runXPostTitle, aiController) : undefined;
    });
  try {
    const [fetchResult, enrichedSource] = await Promise.all([
      deps.safeFetch(link.url),
      // Defense in depth (reliability review): `enrichSource` is already
      // contracted never to throw (its dispatcher wraps everything in a
      // try/catch), but a best-effort rich-preview enricher must NEVER be the
      // thing that fails an otherwise-fine capture — so a second, cheap
      // `.catch` here guarantees that even a future regression in that
      // contract degrades to "no sourceData this pass" rather than propagating
      // and failing the whole `enrichLink` job.
      sourcePromise.catch(() => undefined),
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
        status: holdFull ? 'full' : mapSafeFetchFailureToStatus(fetchResult.reason),
        ...aiTitleFields(await aiTitlePromise),
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

    const selected = await (deps.selectReader ?? selectReader)(
      link.sourceKind,
      extracted,
      youtube,
      {
        url: fetchResult.finalUrl,
        contentType: fetchResult.contentType,
        signal: AbortSignal.timeout(60_000),
      },
    );
    await recordExtraction(link, extracted, selected, {
      sourceData,
      holdFull,
      fetchedAt,
      aiTitle: await aiTitlePromise,
    });
  } finally {
    // Early returns and capture failures must also stop pending AI work.
    aiController.abort();
  }
}

type NarrowLink = Pick<
  LinkSummaryWithTags,
  | 'id'
  | 'url'
  | 'sourceKind'
  | 'sourceData'
  | 'titleSource'
  | 'captureStatus'
  | 'enrichFloorStatus'
  | 'enrichFields'
>;
type EnrichPlan = NonNullable<ReturnType<typeof planEnrich>>;

function storedSource(link: NarrowLink): SourceData | undefined {
  const parsed = sourceDataSchema.safeParse(link.sourceData);
  return parsed.success ? parsed.data : undefined;
}

async function narrowSource(
  link: NarrowLink,
  plan: EnrichPlan,
  deps: EnrichLinkDeps,
): Promise<SourceData | undefined> {
  const stored = storedSource(link);
  const missingPost = plan.aiTitle && (stored?.kind !== 'twitter' || !stored.text.trim());
  if (!plan.source && !missingPost) return stored;
  const plugins = await deps.getPluginsSetting().catch(() => SETTINGS_DEFAULTS.plugins);
  return deps.enrichSource(link.sourceKind, link.url, plugins).catch(() => undefined);
}

/** Source API data supplies X metadata without fetching x.com. */
function twitterMetadata(source: SourceData | undefined): ExtractResult {
  if (source?.kind !== 'twitter') return { status: 'bare' };
  return {
    status: 'partial',
    title: source.text,
    description: source.text,
    siteName: 'X',
    ...(source.thumbnailUrl ? { imageUrl: source.thumbnailUrl } : {}),
  };
}

function narrowMetadata(plan: EnrichPlan, extracted: ExtractResult) {
  const { title, description, imageUrl, siteName } = extracted;
  return {
    ...(plan.title && title !== undefined ? { title } : {}),
    ...(plan.metadata && description !== undefined ? { description } : {}),
    ...(plan.metadata && imageUrl !== undefined ? { imageUrl } : {}),
    ...(plan.metadata && siteName !== undefined ? { siteName } : {}),
  };
}

/** A narrow run restores the floor and writes only the columns its fields own. */
async function enrichSelectedFields(
  link: NarrowLink,
  plan: EnrichPlan,
  deps: EnrichLinkDeps,
): Promise<void> {
  const floor = link.enrichFloorStatus ?? link.captureStatus;
  const status = floor === 'enriching' ? 'bare' : floor;
  const fetchedAt = new Date();
  const [source, fetched] = await Promise.all([
    narrowSource(link, plan, deps),
    plan.fetch ? deps.safeFetch(link.url) : undefined,
  ]);
  if (fetched && !fetched.ok) {
    await recordEnrichment(link.id, { status });
    return;
  }
  const extracted = fetched
    ? await deps.extract({
        url: fetched.finalUrl,
        html: fetched.html,
        contentType: fetched.contentType,
        reader: plan.reader,
      })
    : twitterMetadata(plan.metadata ? source : undefined);
  await recordNarrowReader(link, plan, deps, extracted, fetched, fetchedAt);
  const aiTitle = await narrowAiTitle(link, plan, source, deps);
  await recordEnrichment(link.id, {
    status,
    ...narrowResultFields(link, plan, extracted, source),
    ...aiTitleFields(aiTitle),
  });
}

function narrowResultFields(
  link: NarrowLink,
  plan: EnrichPlan,
  extracted: ExtractResult,
  source: SourceData | undefined,
) {
  const metadata =
    link.sourceKind === 'twitter' ? twitterMetadata(plan.metadata ? source : undefined) : extracted;
  return {
    ...narrowMetadata(plan, metadata),
    ...(plan.reader && link.sourceKind === 'twitter' && extracted.text !== undefined
      ? { text: extracted.text }
      : {}),
    ...(plan.writeSource && source ? { sourceData: source } : {}),
  };
}

async function recordNarrowReader(
  link: NarrowLink,
  plan: EnrichPlan,
  deps: EnrichLinkDeps,
  extracted: ExtractResult,
  fetched: Extract<SafeFetchResult, { ok: true }> | undefined,
  fetchedAt: Date,
): Promise<void> {
  if (plan.reader && fetched) {
    const youtube =
      link.sourceKind === 'youtube'
        ? extractYouTubeWatch(fetched.html, fetched.finalUrl)
        : undefined;
    const selected = await (deps.selectReader ?? selectReader)(
      link.sourceKind,
      extracted,
      youtube,
      {
        url: fetched.finalUrl,
        contentType: fetched.contentType,
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (link.sourceKind !== 'twitter') await recordReader(link.id, selected, fetchedAt);
  }
}

async function narrowAiTitle(
  link: NarrowLink,
  plan: EnrichPlan,
  source: SourceData | undefined,
  deps: EnrichLinkDeps,
): Promise<string | undefined> {
  if (!plan.aiTitle) return undefined;
  // Row fields are an owner's request even if queue dedup kept an older payload.
  const input = aiTitleInput(link, source, {
    trigger: 'manual',
    previousStatus: link.captureStatus,
  });
  const run = deps.runXPostTitle ?? defaultDeps.runXPostTitle;
  if (!input || !run) return undefined;
  const controller = new AbortController();
  try {
    return await startAiTitle(input, run, controller);
  } finally {
    controller.abort();
  }
}

type ExtractionRecord = {
  sourceData: SourceData | undefined;
  holdFull: boolean;
  fetchedAt: Date;
  /** A fresh AI title for an X post, or `undefined` to keep the page title. */
  aiTitle: string | undefined;
};

/** Record a successful fetch + extract, including the Reader (see `enrichLink`). */
async function recordExtraction(
  link: { id: string; sourceKind: string },
  extracted: ExtractResult,
  selected: ReaderExtraction,
  { sourceData, holdFull, fetchedAt, aiTitle }: ExtractionRecord,
): Promise<void> {
  const linkId = link.id;
  updateRenderedStatus(extracted, selected);
  if (link.sourceKind === 'youtube') extracted.status = 'partial';
  // A held `full` link whose re-run comes back thin keeps everything it has:
  // no Reader write, and no title, description, image or text from the thin
  // result (only the source data and the status, which stays `full`). A
  // successful AI title is the exception: the post text is fresh, so it is written.
  if (holdFull && extracted.status !== 'full') {
    await recordThenMaybeSettle(linkId, {
      status: 'full',
      ...aiTitleFields(aiTitle),
      ...(sourceData ? { sourceData } : {}),
    });
    return;
  }
  if (link.sourceKind !== 'twitter') await recordReader(linkId, selected, fetchedAt);
  const { reader: _reader, readerFailed: _readerFailed, text, ...stored } = extracted;
  // Reader writes own search text, including empty results and rejected older captures.
  await recordThenMaybeSettle(linkId, {
    ...stored,
    ...aiTitleFields(aiTitle),
    ...(link.sourceKind === 'twitter' && text !== undefined ? { text } : {}),
    ...(sourceData ? { sourceData } : {}),
  });
}

/**
 * A sweep run starts from `enriching` (the re-kick sets it). A sweep job that
 * finds another status is a duplicate of a run that already finished, so it
 * does nothing. Manual and capture jobs always run: an Enrich click or a
 * re-save must be answered, and a held `full` link cannot be downgraded.
 */
function isFinishedSweepDuplicate(
  status: CaptureStatus | 'enriching',
  job: EnrichJobData | undefined,
): boolean {
  return job?.trigger === 'sweep' && status !== 'enriching';
}

function updateRenderedStatus(extracted: ExtractResult, selected: ReaderExtraction): void {
  if (selected.status === 'reader' && selected.reader !== extracted.reader)
    extracted.status = (selected.text?.length ?? 0) >= FULL_TEXT_THRESHOLD ? 'full' : 'partial';
}
