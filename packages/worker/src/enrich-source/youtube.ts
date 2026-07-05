/**
 * YouTube enricher — fetches the public, keyless oEmbed endpoint for the
 * video's `author_name` (mapped to `channel`), and pairs it with a
 * DETERMINISTIC thumbnail URL derived from the video id — no fetch is needed
 * to know that URL, only to later display it (via the preview-image proxy,
 * on deliberate hover — see `packages/api/src/routes/preview-image.ts`).
 *
 * Duration is deliberately DROPPED from this slice (plan 012): the YouTube
 * Data API v3 (the only source for duration) requires a paid/quota-gated
 * API key that oEmbed doesn't need — out of scope rather than half-built
 * behind a key nobody has yet.
 *
 * Degrades gracefully on ANY failure (private/deleted/age-restricted video —
 * oEmbed 401/403/404s those — timeout, malformed JSON) — same contract as
 * the HN/GitHub enrichers.
 */

import type { SourceData } from '@silo/core';
import { sourceDataSchema } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';

/** The subset of the oEmbed JSON response this enricher actually reads. */
interface YouTubeOEmbedResponse {
  author_name?: unknown;
}

function oembedUrl(videoId: string): string {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
}

/** `img.youtube.com/vi/{id}/hqdefault.jpg` — always resolvable for any real video id, no API call needed to construct it. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

type YouTubeSourceData = Extract<SourceData, { kind: 'youtube' }>;

/**
 * Fetch + shape a YouTube video's `SourceData`. `fetchFn` is the SSRF-safe
 * fetcher (injected so tests can stub it without a real network call).
 */
export async function enrichYouTube(
  videoId: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<YouTubeSourceData | undefined> {
  const result = await fetchFn(oembedUrl(videoId));
  if (!result.ok) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.html);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;

  const data = parsed as YouTubeOEmbedResponse;
  const candidate = {
    kind: 'youtube' as const,
    channel: data.author_name,
    thumbnailUrl: youtubeThumbnailUrl(videoId),
  };
  const shaped = sourceDataSchema.safeParse(candidate);
  return shaped.success && shaped.data.kind === 'youtube' ? shaped.data : undefined;
}
