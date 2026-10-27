import { getById, type ReaderContent, readLive } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

const readerParams = z.object({ id: z.uuid() });

/**
 * The live Reader for a stored, non-trashed link, or `undefined` when the link
 * is missing or trashed, or its page has no Reader content. The worker caches
 * the result, so the page and its images share one fetch.
 */
export async function loadReader(
  id: string,
  signal: AbortSignal,
): Promise<ReaderContent | undefined> {
  const link = await getById(id);
  if (!link) return undefined;
  return readLive({ id: link.id, url: link.url, sourceKind: link.sourceKind }, signal);
}

export function registerReaderRoutes(app: Hono): void {
  app.get('/links/:id/reader', async (c) => {
    const { id } = readerParams.parse(c.req.param());
    const reader = await loadReader(id, c.req.raw.signal);
    if (!reader)
      return c.json({ error: 'not_found', message: 'No Reader content for this link' }, 404);
    return c.json({ contentHtml: reader.contentHtml, contentImages: reader.contentImages });
  });
}
