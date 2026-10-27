import { linkTitles } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

const httpUrl = z
  .string()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value) && URL.canParse(value), 'http(s) URL');
const titlesBodySchema = z.object({ urls: z.array(httpUrl).min(1).max(20) });

/** Mounted inside the general API auth and cookie-CSRF middleware. */
export function registerLinksTitlesRoutes(app: Hono): void {
  app.post('/links/titles', async (c) => {
    const body = titlesBodySchema.parse(await c.req.json());
    return c.json({ titles: await linkTitles(body.urls, c.req.raw.signal) });
  });
}
