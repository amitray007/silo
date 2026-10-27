/**
 * Twitter/X enricher — fetches the unauthed, keyless FxEmbed endpoint
 * (`GET https://api.fxtwitter.com/2/thread/{id}`, no API key/token) and maps
 * its response onto the `twitter` `SourceData` variant (live-enrichment
 * slice). The thread call returns the requested post as `status` plus the
 * author's whole self-reply chain as `thread`; the other posts of that chain
 * are stored as `threadBefore` / `threadAfter`. When the thread call fails for
 * any reason, the enricher falls back to the plain
 * `GET https://api.fxtwitter.com/status/{id}` call so a capture is never worse
 * than before threads existed. Unlike the `silo ingest x` CLI's pre-extracted, trusted payload
 * (see `source-data.ts`'s `twitterSourceData` doc comment for that history),
 * this enricher fetches the tweet itself server-side — no CLI/bookmark-
 * export step required to get a rich Twitter card.
 *
 * FxEmbed is a THIRD-PARTY, UNDOCUMENTED, X-derived service — it can change
 * shape or go away without notice. This enricher degrades gracefully on ANY
 * failure (network/timeout, non-200 `code`, missing `tweet`, malformed/
 * missing required fields, schema-fail) — same contract as the HN/GitHub/
 * YouTube enrichers: a broken FxEmbed must leave a plain, working link,
 * never crash a capture.
 *
 * Field mapping (FxEmbed's `status` / `tweet` -> silo's `twitter` SourceData):
 *   text                  -> text
 *   author.screen_name    -> authorHandle
 *   author.name           -> authorName
 *   author.avatar_url     -> authorAvatarUrl (optional)
 *   reposts | retweets   -> reposts        (the v2 thread call says "reposts", the
 *                            plain status call says "retweets")
 *   likes                 -> likes
 *   replies               -> replies
 *   quotes                -> quotes
 *   bookmarks             -> bookmarks
 *   created_at             -> postedAt (stored as given, not reparsed)
 *   lang                  -> language (only when exactly 2 chars — FxEmbed can
 *                            return "und"/undetermined, which the schema's
 *                            `.length(2)` would otherwise reject)
 *   possibly_sensitive    -> possiblySensitive (optional)
 *   media.all[].url       -> mediaUrls (optional, thumbnail/photo urls only —
 *                            kept as raw metadata, see source-data.ts's
 *                            RENDERER SAFETY note — never rendered as a raw
 *                            `<img src>` in the web app)
 *   media (best single)   -> thumbnailUrl (optional — command-center polish
 *                            slice: the ONE best media thumbnail for this
 *                            tweet, picked by `extractThumbnailUrl` below. A
 *                            video's `media.all[0].thumbnail_url` (its poster
 *                            frame, a twimg.com still) is preferred when
 *                            present; otherwise the first photo's url
 *                            (`media.photos[0].url`, falling back to
 *                            `media.all[0].url`). Consumed by `enrich.ts`,
 *                            which overrides the page's own (useless,
 *                            generic X-logo) og:image `imageUrl` with this
 *                            when present — see that module's doc comment.)
 *
 *   thread[] (same author, minus the saved post) -> threadBefore / threadAfter
 *                            (id, text, created_at -> postedAt, likes, reposts,
 *                            replies, media -> mediaUrls / thumbnailUrl; up to
 *                            THREAD_SIDE_MAX per side, nearest to the saved post)
 *
 * `text`/`authorHandle`/`authorName` are REQUIRED by the schema (min length
 * 1) — a response missing any of them degrades to `undefined` rather than
 * saving a half-populated twitter card.
 */

import type { SourceData } from '@silo/core';
import { sourceDataSchema, THREAD_SIDE_MAX, twitterThreadPostSchema } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { fetchJsonObject } from './fetch-json.js';

/** The subset of FxEmbed's `author` object this enricher actually reads. */
interface FxEmbedAuthor {
  screen_name?: unknown;
  name?: unknown;
  avatar_url?: unknown;
}

/** The subset of FxEmbed's nested `media` object this enricher actually reads. */
interface FxEmbedMediaItem {
  url?: unknown;
  /** Present on video/gif media items — a twimg.com poster-frame still. */
  thumbnail_url?: unknown;
}
interface FxEmbedMedia {
  all?: unknown;
  /** FxEmbed also breaks media out by type; `photos` is used as the
   * photo-specific fallback when `all[0]` isn't itself a photo. */
  photos?: unknown;
}

/** The subset of FxEmbed's `tweet` JSON this enricher actually reads. */
interface FxEmbedTweet {
  text?: unknown;
  author?: unknown;
  replies?: unknown;
  /** The v2 thread call names the repost count `reposts`. */
  reposts?: unknown;
  /** The plain status call names it `retweets`. */
  retweets?: unknown;
  likes?: unknown;
  bookmarks?: unknown;
  quotes?: unknown;
  created_at?: unknown;
  lang?: unknown;
  possibly_sensitive?: unknown;
  media?: unknown;
}

/** The status envelope: `{ code, message, tweet }`. */
interface FxEmbedResponse {
  code?: unknown;
  tweet?: unknown;
}

/** The v2 thread envelope: `{ code, status, author, thread }`. */
interface FxEmbedThreadResponse {
  code?: unknown;
  status?: unknown;
  thread?: unknown;
}

function statusUrl(tweetId: string): string {
  return `https://api.fxtwitter.com/status/${encodeURIComponent(tweetId)}`;
}

function threadUrl(tweetId: string): string {
  return `https://api.fxtwitter.com/2/thread/${encodeURIComponent(tweetId)}`;
}

/** A non-negative integer count, coerced from FxEmbed's number — `undefined` when absent/not a valid number (mirrors the schema's own `.int().nonnegative()` guard, checked here so a bad count degrades the WHOLE candidate via schema-fail rather than silently becoming `NaN`/negative). */
function toCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.trunc(value);
  return rounded >= 0 ? rounded : undefined;
}

/**
 * Best-effort thumbnail/photo urls off FxEmbed's nested `media.all[].url` —
 * kept as raw metadata only (never rendered as a raw `<img src>` in the web
 * app — see source-data.ts's RENDERER SAFETY note), so this is populated
 * only when trivially available and never over-engineered (no video-variant
 * selection, no size negotiation).
 */
function extractMediaUrls(media: unknown): string[] | undefined {
  if (media === null || typeof media !== 'object') return undefined;
  const all = (media as FxEmbedMedia).all;
  if (!Array.isArray(all)) return undefined;
  const urls = all
    .map((item) =>
      item !== null && typeof item === 'object' ? (item as FxEmbedMediaItem).url : undefined,
    )
    .filter(
      (url): url is string => typeof url === 'string' && url.length > 0 && url.length <= 2_000,
    );
  return urls.length > 0 ? urls.slice(0, 64) : undefined;
}

/** A bounded, non-empty string url, or `undefined` for anything else — the one validity check every candidate thumbnail/photo url in `extractThumbnailUrl` needs. */
function isUsableUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_000;
}

/**
 * Picks the SINGLE best media thumbnail for the tweet, in priority order
 * (command-center polish slice — see this module's doc comment for the
 * verified FxEmbed shape):
 *
 *   1. `media.all[0].thumbnail_url` — a video/gif's poster-frame still. Videos
 *      are preferred first because FxEmbed's own og:image for a video tweet
 *      IS this same still, so it's the most representative single frame.
 *   2. `media.photos[0].url` — the first photo, when FxEmbed breaks media out
 *      by type.
 *   3. `media.all[0].url` — the first media item's own url, as a last-resort
 *      fallback when neither of the above is present (e.g. a photo-only
 *      response that only populated `all`, not `photos`).
 *
 * Returns `undefined` for a text-only tweet (no `media` at all) or any
 * malformed/unusable shape — this is a "nice to have," never a reason to
 * fail the candidate.
 */
function extractThumbnailUrl(media: unknown): string | undefined {
  if (media === null || typeof media !== 'object') return undefined;
  const m = media as FxEmbedMedia;

  const all = Array.isArray(m.all) ? m.all : undefined;
  const firstAll =
    all && all[0] !== null && typeof all[0] === 'object' ? (all[0] as FxEmbedMediaItem) : undefined;
  if (firstAll && isUsableUrl(firstAll.thumbnail_url)) {
    return firstAll.thumbnail_url;
  }

  const photos = Array.isArray(m.photos) ? m.photos : undefined;
  const firstPhoto =
    photos && photos[0] !== null && typeof photos[0] === 'object'
      ? (photos[0] as FxEmbedMediaItem)
      : undefined;
  if (firstPhoto && isUsableUrl(firstPhoto.url)) {
    return firstPhoto.url;
  }

  if (firstAll && isUsableUrl(firstAll.url)) {
    return firstAll.url;
  }

  return undefined;
}

type TwitterSourceData = Extract<SourceData, { kind: 'twitter' }>;

/**
 * The optional-field subset of the candidate — split out from `enrichTwitter`
 * purely to keep that function's branching under the lint complexity budget.
 * Only includes a key when its source value is genuinely present + valid, so
 * an omitted-vs-invalid upstream field maps onto the schema's `.optional()`
 * (which rejects `null`/wrong-shape) rather than failing validation.
 */
function optionalFields(tweet: FxEmbedTweet, author: FxEmbedAuthor | undefined) {
  const fields: Record<string, unknown> = {};
  if (typeof author?.avatar_url === 'string' && author.avatar_url.length > 0) {
    fields.authorAvatarUrl = author.avatar_url;
  }
  if (typeof tweet.created_at === 'string' && tweet.created_at.length > 0) {
    fields.postedAt = tweet.created_at;
  }
  // Only a genuine 2-letter code satisfies the schema's `.length(2)` — FxEmbed
  // can return "und" (undetermined) or omit `lang` entirely; both degrade to
  // "no language" rather than failing the whole candidate.
  if (typeof tweet.lang === 'string' && tweet.lang.length === 2) {
    fields.language = tweet.lang;
  }
  if (typeof tweet.possibly_sensitive === 'boolean') {
    fields.possiblySensitive = tweet.possibly_sensitive;
  }
  const mediaUrls = extractMediaUrls(tweet.media);
  if (mediaUrls) {
    fields.mediaUrls = mediaUrls;
  }
  const thumbnailUrl = extractThumbnailUrl(tweet.media);
  if (thumbnailUrl) {
    fields.thumbnailUrl = thumbnailUrl;
  }
  return fields;
}

type ThreadPost = NonNullable<TwitterSourceData['threadBefore']>[number];

/** Cuts text to `max` UTF-16 units without leaving half of a surrogate pair, which Postgres jsonb rejects. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function screenNameOf(tweet: Record<string, unknown>): string | undefined {
  const name = asObject(tweet.author)?.screen_name;
  return typeof name === 'string' ? name.toLowerCase() : undefined;
}

/** One post of the thread, or `undefined` when it does not fit the stored shape. */
function toThreadPost(tweet: Record<string, unknown>): ThreadPost | undefined {
  const fields: Record<string, unknown> = {
    id: tweet.id,
    text: typeof tweet.text === 'string' ? clampText(tweet.text, 4_000) : undefined,
    likes: toCount(tweet.likes),
    reposts: toCount(tweet.reposts ?? tweet.retweets),
    replies: toCount(tweet.replies),
  };
  if (typeof tweet.created_at === 'string' && tweet.created_at.length > 0) {
    fields.postedAt = tweet.created_at;
  }
  const mediaUrls = extractMediaUrls(tweet.media);
  if (mediaUrls) fields.mediaUrls = mediaUrls;
  const thumbnailUrl = extractThumbnailUrl(tweet.media);
  if (thumbnailUrl) fields.thumbnailUrl = thumbnailUrl;
  const parsed = twitterThreadPostSchema.safeParse(fields);
  return parsed.success ? parsed.data : undefined;
}

/** Same-author posts of `items` that fit the stored shape, each id once and never the saved post. */
function sameAuthorPosts(items: unknown[], handle: string, seen: Set<string>): ThreadPost[] {
  const posts: ThreadPost[] = [];
  for (const item of items) {
    const tweet = asObject(item);
    if (!tweet || screenNameOf(tweet) !== handle) continue;
    const post = toThreadPost(tweet);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }
  return posts;
}

/**
 * Splits the author's chain around the saved post. A chain that does not
 * contain the saved post yields no thread rather than a guessed order.
 */
function threadFields(thread: unknown, statusId: string, handle: string): Record<string, unknown> {
  if (!Array.isArray(thread)) return {};
  const at = thread.findIndex((item) => asObject(item)?.id === statusId);
  if (at < 0) return {};
  const seen = new Set<string>([statusId]);
  const owner = handle.toLowerCase();
  const before = sameAuthorPosts(thread.slice(0, at), owner, seen).slice(-THREAD_SIDE_MAX);
  const after = sameAuthorPosts(thread.slice(at + 1), owner, seen).slice(0, THREAD_SIDE_MAX);
  return {
    ...(before.length > 0 ? { threadBefore: before } : {}),
    ...(after.length > 0 ? { threadAfter: after } : {}),
  };
}

/** Maps one post object (`tweet` or `status`) onto the stored candidate, before validation. */
function tweetCandidate(tweet: FxEmbedTweet): Record<string, unknown> {
  const author =
    tweet.author !== null && typeof tweet.author === 'object'
      ? (tweet.author as FxEmbedAuthor)
      : undefined;
  return {
    kind: 'twitter',
    text: typeof tweet.text === 'string' ? clampText(tweet.text, 4_000) : tweet.text,
    authorHandle: author?.screen_name,
    authorName: author?.name,
    likes: toCount(tweet.likes),
    reposts: toCount(tweet.reposts ?? tweet.retweets),
    replies: toCount(tweet.replies),
    quotes: toCount(tweet.quotes),
    bookmarks: toCount(tweet.bookmarks),
    ...optionalFields(tweet, author),
  };
}

function shape(candidate: Record<string, unknown>): TwitterSourceData | undefined {
  const shaped = sourceDataSchema.safeParse(candidate);
  return shaped.success && shaped.data.kind === 'twitter' ? shaped.data : undefined;
}

/** The thread call: the saved post as `status` plus the author's chain as `thread`. */
async function fromThread(
  tweetId: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<TwitterSourceData | undefined> {
  const parsed = await fetchJsonObject(threadUrl(tweetId), fetchFn);
  if (parsed === undefined) return undefined;
  const envelope = parsed as FxEmbedThreadResponse;
  if (envelope.code !== 200) return undefined;
  const status = asObject(envelope.status);
  if (!status) return undefined;

  const candidate = tweetCandidate(status as FxEmbedTweet);
  const statusId = typeof status.id === 'string' ? status.id : tweetId;
  const handle = typeof candidate.authorHandle === 'string' ? candidate.authorHandle : undefined;
  return shape({
    ...candidate,
    ...(handle ? threadFields(envelope.thread, statusId, handle) : {}),
  });
}

/** The plain status call, used on its own when the thread call gave nothing usable. */
async function fromStatus(
  tweetId: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<TwitterSourceData | undefined> {
  const parsed = await fetchJsonObject(statusUrl(tweetId), fetchFn);
  if (parsed === undefined) return undefined;

  const envelope = parsed as FxEmbedResponse;
  if (envelope.code !== 200) return undefined;
  const tweet = asObject(envelope.tweet);
  if (!tweet) return undefined;
  return shape(tweetCandidate(tweet as FxEmbedTweet));
}

/**
 * Fetch + shape a tweet's `SourceData` via FxEmbed. `fetchFn` is the
 * SSRF-safe fetcher — injected so tests can stub it without a real network
 * call (and so production always goes through `safeFetch`, since
 * api.fxtwitter.com is an external host like GitHub's/YouTube's APIs).
 * Tries the thread call first and falls back to the plain status call.
 */
export async function enrichTwitter(
  tweetId: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<TwitterSourceData | undefined> {
  return (await fromThread(tweetId, fetchFn)) ?? (await fromStatus(tweetId, fetchFn));
}
