import type { SourceData } from '@silo/core';
import { getById, sourceDataSchema } from '@silo/core';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { allowedImageContentType, imageResponse } from '../image-response.js';
import { fetchImageSafely, openStreamSafely } from '../ssrf-safe-image-fetch.js';

/**
 * `GET /api/links/:id/source-media/:index` serves an X post's own captured
 * photos and videos so the browser never calls X's media hosts. Like
 * `content-image`, the client names only a link and an index; the URL comes
 * from storage, must be on X's media hosts, and still goes through the
 * SSRF-safe fetch. Videos stream with Range passthrough so the player can seek
 * without downloading the whole file.
 *
 * The `:index` forms:
 *   `3`            the saved post's 4th media item (`mediaUrls[3]`)
 *   `poster`       the saved post's video still (`thumbnailUrl`)
 *   `avatar`       the author's profile picture (`authorAvatarUrl`)
 *   `after-2-1`    media item 1 of the 3rd post in `threadAfter`
 *   `before-0-3`   media item 3 of the 1st post in `threadBefore`
 *   `after-2-poster` / `before-0-poster`   that thread post's video still
 * Post and media numbers are 1 or 2 digits with no sign or leading text, so
 * nothing else reaches the lookup.
 */
const MEDIA_HOSTS: ReadonlySet<string> = new Set(['pbs.twimg.com', 'video.twimg.com']);
const VIDEO_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm']);
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;
const THREAD_INDEX = /^(before|after)-(\d{1,2})-(\d{1,2}|poster)$/;

type MediaRef =
  | { kind: 'media'; index: number }
  | { kind: 'poster' }
  | { kind: 'avatar' }
  | { kind: 'thread'; side: 'before' | 'after'; post: number; media: number | 'poster' };

function parseIndex(raw: string): MediaRef | undefined {
  if (raw === 'poster' || raw === 'avatar') return { kind: raw };
  if (/^\d{1,2}$/.test(raw)) return { kind: 'media', index: Number(raw) };
  const match = THREAD_INDEX.exec(raw);
  if (!match) return undefined;
  const [, side, post, media] = match;
  if ((side !== 'before' && side !== 'after') || post === undefined || media === undefined)
    return undefined;
  return {
    kind: 'thread',
    side,
    post: Number(post),
    media: media === 'poster' ? 'poster' : Number(media),
  };
}

const params = z.object({
  id: z.uuid(),
  index: z.string().transform((raw, ctx) => {
    const ref = parseIndex(raw);
    if (!ref) ctx.addIssue({ code: 'custom', message: 'Invalid media index' });
    return ref ?? z.NEVER;
  }),
});

type Target = { url: string; video: boolean };
type TwitterData = Extract<SourceData, { kind: 'twitter' }>;

function storedUrl(data: TwitterData, ref: MediaRef): string | undefined {
  switch (ref.kind) {
    case 'poster':
      return data.thumbnailUrl;
    case 'avatar':
      return data.authorAvatarUrl;
    case 'media':
      return data.mediaUrls?.[ref.index];
    case 'thread': {
      const post = (ref.side === 'before' ? data.threadBefore : data.threadAfter)?.[ref.post];
      if (!post) return undefined;
      return ref.media === 'poster' ? post.thumbnailUrl : post.mediaUrls?.[ref.media];
    }
  }
}

function mediaTarget(sourceData: unknown, ref: MediaRef): Target | undefined {
  const parsed = sourceDataSchema.safeParse(sourceData);
  if (!parsed.success || parsed.data.kind !== 'twitter') return undefined;
  const raw = storedUrl(parsed.data, ref);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port !== '' || !MEDIA_HOSTS.has(url.hostname))
      return undefined;
    return { url: url.href, video: url.hostname === 'video.twimg.com' };
  } catch {
    return undefined;
  }
}

const missing = (c: Context) =>
  c.json({ error: 'not_found', message: 'Post media unavailable' }, 404);

async function streamVideo(c: Context, url: string): Promise<Response> {
  const range = c.req.header('range');
  // Identity keeps upstream byte counts true; a decoded body would break Content-Range.
  const opened = await openStreamSafely(url, {
    headers: { 'accept-encoding': 'identity', ...(range && RANGE.test(range) ? { range } : {}) },
    signal: c.req.raw.signal,
    timeoutMs: 10_000,
    passStatuses: [416],
  });
  if (!opened.ok) return missing(c);
  const { response, close } = opened;
  if (response.status === 416) {
    await close();
    const unsatisfied = new Headers({ 'Accept-Ranges': 'bytes' });
    const total = response.headers.get('content-range');
    if (total) unsatisfied.set('Content-Range', total);
    return new Response(null, { status: 416, headers: unsatisfied });
  }
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!type || !VIDEO_TYPES.has(type) || !opened.body) {
    await close();
    return missing(c);
  }
  const headers = new Headers({
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of ['content-length', 'content-range']) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(opened.body, { status: response.status, headers });
}

export function registerSourceMediaRoutes(app: Hono): void {
  app.get('/links/:id/source-media/:index', async (c) => {
    const { id, index } = params.parse(c.req.param());
    const link = await getById(id);
    const target = link ? mediaTarget(link.sourceData, index) : undefined;
    if (!target) return missing(c);
    // Hono answers HEAD with the GET handler and drops the body, which would strand the stream.
    if (target.video && c.req.method === 'HEAD')
      return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    if (target.video) return streamVideo(c, target.url);
    const result = await fetchImageSafely(target.url);
    const contentType = result.ok ? allowedImageContentType(result.contentType) : undefined;
    if (!result.ok || !contentType) return missing(c);
    const response = imageResponse(result.bytes, contentType);
    response.headers.set('Cache-Control', 'private, max-age=86400');
    return response;
  });
}
