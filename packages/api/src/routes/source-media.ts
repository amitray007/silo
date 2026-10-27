import { getById, sourceDataSchema } from '@silo/core';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { allowedImageContentType, imageResponse } from '../image-response.js';
import { fetchImageSafely, openStreamSafely } from '../ssrf-safe-image-fetch.js';

/**
 * `GET /api/links/:id/source-media/:index` serves an X post's own captured
 * photos and videos (`sourceData.mediaUrls`, and `poster` for its video still)
 * so the browser never calls X's media hosts. Like `content-image`, the client
 * names only a link and an index; the URL comes from storage, must be on X's
 * media hosts, and still goes through the SSRF-safe fetch. Videos stream with
 * Range passthrough so the player can seek without downloading the whole file.
 */
const MEDIA_HOSTS: ReadonlySet<string> = new Set(['pbs.twimg.com', 'video.twimg.com']);
const VIDEO_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm']);
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;

const params = z.object({
  id: z.uuid(),
  index: z.union([
    z.literal('poster'),
    z
      .string()
      .regex(/^\d{1,2}$/)
      .transform(Number),
  ]),
});

type Target = { url: string; video: boolean };

function mediaTarget(sourceData: unknown, index: number | 'poster'): Target | undefined {
  const parsed = sourceDataSchema.safeParse(sourceData);
  if (!parsed.success || parsed.data.kind !== 'twitter') return undefined;
  const data = parsed.data;
  const raw = index === 'poster' ? data.thumbnailUrl : data.mediaUrls?.[index];
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
