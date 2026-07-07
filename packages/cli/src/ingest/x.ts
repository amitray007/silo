import type { IngestRequest, SourceData } from '../types.js';
import type { FieldTheoryBookmark } from './fieldtheory.js';

/**
 * Maps one Field Theory bookmark to a `POST /api/ingest` payload, per the
 * LOCKED mapping decision in `docs/plans/refs/fieldtheory-bookmarks-
 * schema.md`: 1 bookmark -> 1 silo link (the tweet itself); `engagement.
 * *Count` -> the twitter variant's counts; `media` -> `mediaUrls`; `links`
 * -> `externalLinks` (kept as metadata, NOT split into separate silo
 * entries). Bounds mirror `packages/core/src/links/source-data.ts`'s
 * `twitterSourceData` Zod schema EXACTLY (this is a plain mapper, not a
 * validator — the API still re-validates via that same schema on ingest; the
 * clamps here exist so a bookmark that's merely slightly out-of-bounds
 * (e.g. FT's `text` limit differs from silo's 4000-char cap) gets truncated
 * rather than rejected outright, per the plan's "skip/truncate a bookmark
 * that can't map rather than crashing the whole run"). Returns `null` when
 * the bookmark is missing a field silo has NO fallback for (there is none
 * today — every required field is already validated present by
 * `parseBookmarkLine` — `null` is kept as the return type for a future
 * stricter rule without changing this function's signature again).
 */
export function mapBookmarkToIngest(bookmark: FieldTheoryBookmark): IngestRequest | null {
  const text = clamp(bookmark.text, 1, 4000);
  const authorHandle = clamp(bookmark.authorHandle, 1, 256);
  const authorName = clamp(bookmark.authorName, 1, 256);
  if (text === null || authorHandle === null || authorName === null) return null;

  const sourceData: SourceData = {
    kind: 'twitter',
    text,
    authorHandle,
    authorName,
    likes: nonNegative(bookmark.engagement?.likeCount),
    reposts: nonNegative(bookmark.engagement?.repostCount),
    replies: nonNegative(bookmark.engagement?.replyCount),
    quotes: nonNegative(bookmark.engagement?.quoteCount),
    bookmarks: nonNegative(bookmark.engagement?.bookmarkCount),
  };

  const avatar = clampOptional(bookmark.authorProfileImageUrl, 1, 2000);
  if (avatar !== undefined) sourceData.authorAvatarUrl = avatar;

  const postedAt = clampOptional(bookmark.postedAt, 1, 64);
  if (postedAt !== undefined) sourceData.postedAt = postedAt;

  // The schema requires EXACTLY 2 chars for `language` — a value of any
  // other length is dropped rather than truncated/padded (a truncated
  // language code would be actively wrong, not merely lossy).
  if (bookmark.language !== undefined && bookmark.language.length === 2) {
    sourceData.language = bookmark.language;
  }

  if (bookmark.possiblySensitive !== undefined) {
    sourceData.possiblySensitive = bookmark.possiblySensitive;
  }

  const mediaUrls = clampArray(bookmark.media, 64, 2000);
  if (mediaUrls.length > 0) sourceData.mediaUrls = mediaUrls;

  const externalLinks = clampArray(bookmark.links, 64, 2000);
  if (externalLinks.length > 0) sourceData.externalLinks = externalLinks;

  return {
    url: bookmark.url,
    sourceKind: 'twitter',
    note: text,
    sourceData,
  };
}

/** Clamps a required string to `[min, max]` chars — truncates if over, returns `null` if under `min` (i.e. empty when `min` is 1) since there's no safe way to pad a required field. */
function clamp(value: string, min: number, max: number): string | null {
  if (value.length < min) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Clamps an optional string, dropping it entirely (returns `undefined`) rather than sending an out-of-bounds or empty value. */
function clampOptional(value: string | undefined, min: number, max: number): string | undefined {
  if (value === undefined) return undefined;
  const clamped = clamp(value, min, max);
  return clamped ?? undefined;
}

/** Clamps an optional string array to `maxCount` items, each `<= maxLen` chars — mirrors `twitterSourceData`'s `.max(64)`/per-url `.max(2_000)` bounds. */
function clampArray(values: string[] | undefined, maxCount: number, maxLen: number): string[] {
  if (!values) return [];
  return values.slice(0, maxCount).map((v) => (v.length > maxLen ? v.slice(0, maxLen) : v));
}

/** A non-negative integer engagement count, defaulting to `0` when FT's `engagement` object (or a specific count) is absent — `twitterSourceData`'s counts are all required, non-optional fields. */
function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
