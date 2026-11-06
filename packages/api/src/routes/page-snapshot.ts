import { savePageSnapshot } from '@silo/core';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

export const pageBodyLimit = bodyLimit({
  maxSize: 10 * 1024 * 1024,
  onError: (c) =>
    c.json({ error: 'payload_too_large', message: 'Request body exceeds 10 MB' }, 413),
});
const pageSchema = z.object({
  url: z.url(),
  html: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024),
  capturedAt: z.iso.datetime().transform((s) => new Date(s)),
});
export function registerPageSnapshotRoutes(app: Hono): void {
  app.put('/links/:id/page', async (c) => {
    const id = z.uuid().parse(c.req.param('id'));
    const page = pageSchema.parse(await c.req.json());
    const result = await savePageSnapshot(id, page);
    if (result === 'not_found') return c.json({ error: result, message: 'Link not found' }, 404);
    if (result === 'url_mismatch')
      return c.json({ error: result, message: 'Page URL differs from saved link' }, 400);
    return c.json({ status: result }, 202);
  });
}
