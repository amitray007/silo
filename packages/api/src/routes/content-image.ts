import { getById } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { allowedImageContentType, imageResponse } from '../image-response.js';
import { fetchImageSafely } from '../ssrf-safe-image-fetch.js';

const imageParams = z.object({
  id: z.uuid(),
  index: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(9_999)),
});

export function registerContentImageRoutes(app: Hono): void {
  app.get('/links/:id/content-image/:index', async (c) => {
    const { id, index } = imageParams.parse(c.req.param());
    const link = await getById(id);
    const target = link?.contentImages?.[index];
    if (!target)
      return c.json({ error: 'not_found', message: 'No Reader image at this index' }, 404);
    const result = await fetchImageSafely(target);
    const contentType = result.ok ? allowedImageContentType(result.contentType) : undefined;
    if (!result.ok || !contentType) {
      return c.json({ error: 'not_found', message: 'Reader image unavailable' }, 404);
    }
    const response = imageResponse(result.bytes, contentType);
    // Index targets can change after recapture. Do not cache one version under another's URL.
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  });
}
