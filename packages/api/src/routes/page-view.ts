import { PageViewerUnavailableError, viewPage } from '@silo/core';
import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { PAGE_VIEW_HEADERS } from '../page-view-headers.js';

const params = z.object({ id: z.uuid() });

async function pageResponse(c: Context, html: boolean): Promise<Response> {
  if (html) {
    for (const [name, value] of Object.entries(PAGE_VIEW_HEADERS)) c.header(name, value);
  }
  const { id } = params.parse(c.req.param());
  try {
    const page = await viewPage(id, new URL(c.req.url).origin, c.req.raw.signal);
    if (!page) return c.json({ error: 'not_found', message: 'Link not found' }, 404);
    if (!html) {
      c.header('Cache-Control', 'private, no-store');
      return c.json(page.frame);
    }
    if (page.html === undefined)
      return c.json({ error: 'not_found', message: 'Silo view unavailable' }, 404);
    return c.html(page.html, 200, PAGE_VIEW_HEADERS);
  } catch (error) {
    if (!(error instanceof PageViewerUnavailableError)) throw error;
    return c.json({ error: 'service_unavailable', message: 'Page viewer unavailable' }, 503);
  }
}

export function registerPageViewRoutes(app: Hono): void {
  app.get('/links/:id/view', (c) => pageResponse(c, true));
  app.get('/links/:id/frame', (c) => pageResponse(c, false));
}
