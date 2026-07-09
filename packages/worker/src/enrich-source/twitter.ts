/**
 * Twitter/X enricher — fetches the unauthed, keyless FxEmbed endpoint
 * (`GET https://api.fxtwitter.com/status/{id}`, no API key/token) and maps
 * its response onto the `twitter` `SourceData` variant (live-enrichment
 * slice). Unlike the `silo ingest x` CLI's pre-extracted, trusted payload
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
 * Field mapping (FxEmbed's `tweet` -> silo's `twitter` SourceData):
 *   text                  -> text
 *   author.screen_name    -> authorHandle
 *   author.name           -> authorName
 *   author.avatar_url     -> authorAvatarUrl (optional)
 *   retweets              -> reposts        (NAME CHANGE — FxEmbed calls it "retweets")
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
 * `text`/`authorHandle`/`authorName` are REQUIRED by the schema (min length
 * 1) — a response missing any of them degrades to `undefined` rather than
 * saving a half-populated twitter card.
 */

import type { SourceData } from '@silo/core';
import { sourceDataSchema } from '@silo/core';
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
  retweets?: unknown;
  likes?: unknown;
  bookmarks?: unknown;
  quotes?: unknown;
  created_at?: unknown;
  lang?: unknown;
  possibly_sensitive?: unknown;
  media?: unknown;
}

/** The FxEmbed envelope: `{ code, message, tweet }`. */
interface FxEmbedResponse {
  code?: unknown;
  tweet?: unknown;
}

function statusUrl(tweetId: string): string {
  return `https://api.fxtwitter.com/status/${encodeURIComponent(tweetId)}`;
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

/**
 * Fetch + shape a tweet's `SourceData` via FxEmbed. `fetchFn` is the
 * SSRF-safe fetcher — injected so tests can stub it without a real network
 * call (and so production always goes through `safeFetch`, since
 * api.fxtwitter.com is an external host like GitHub's/YouTube's APIs).
 */
export async function enrichTwitter(
  tweetId: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<TwitterSourceData | undefined> {
  const parsed = await fetchJsonObject(statusUrl(tweetId), fetchFn);
  if (parsed === undefined) return undefined;

  const envelope = parsed as FxEmbedResponse;
  if (envelope.code !== 200) return undefined;
  if (envelope.tweet === null || typeof envelope.tweet !== 'object') return undefined;

  const tweet = envelope.tweet as FxEmbedTweet;
  const author =
    tweet.author !== null && typeof tweet.author === 'object'
      ? (tweet.author as FxEmbedAuthor)
      : undefined;

  const candidate: Record<string, unknown> = {
    kind: 'twitter',
    text: tweet.text,
    authorHandle: author?.screen_name,
    authorName: author?.name,
    likes: toCount(tweet.likes),
    reposts: toCount(tweet.retweets),
    replies: toCount(tweet.replies),
    quotes: toCount(tweet.quotes),
    bookmarks: toCount(tweet.bookmarks),
    ...optionalFields(tweet, author),
  };

  const shaped = sourceDataSchema.safeParse(candidate);
  return shaped.success && shaped.data.kind === 'twitter' ? shaped.data : undefined;
}
