import { findSavedUrls } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

const savedBodySchema = z.object({ urls: z.array(z.string()).min(1).max(50) });

/** Mounted inside the general API auth and cookie-CSRF middleware. */
export function registerLinksSavedRoutes(app: Hono): void {
  app.post('/links/saved', async (c) => {
    const body = savedBodySchema.parse(await c.req.json());
    return c.json({ saved: await findSavedUrls(body.urls) });
  });
}
