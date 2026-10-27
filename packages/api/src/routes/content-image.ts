import type { Hono } from 'hono';
import { z } from 'zod';
import { servableImageType, servedImageResponse } from '../image-response.js';
import { fetchImageSafely } from '../ssrf-safe-image-fetch.js';
import { loadReader } from './reader.js';

/** README badges and diagrams are often SVG; past this size an SVG is refused. */
const MAX_SVG_BYTES = 256 * 1024;

const imageParams = z.object({
  id: z.uuid(),
  index: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(9_999)),
});

export function registerContentImageRoutes(app: Hono): void {
  app.get('/links/:id/content-image/:index', async (c) => {
    const { id, index } = imageParams.parse(c.req.param());
    const reader = await loadReader(id, c.req.raw.signal);
    const target = reader?.contentImages[index];
    if (!target)
      return c.json({ error: 'not_found', message: 'No Reader image at this index' }, 404);
    const result = await fetchImageSafely(target);
    const contentType = result.ok
      ? servableImageType(result.contentType, result.bytes, MAX_SVG_BYTES)
      : undefined;
    if (!result.ok || !contentType) {
      return c.json({ error: 'not_found', message: 'Reader image unavailable' }, 404);
    }
    const response = servedImageResponse(result.bytes, contentType);
    // The live page can change between reads. Do not cache one version under another's URL.
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  });
}
