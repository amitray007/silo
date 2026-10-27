import { getById, getStoredReader, type ReaderContent, readLive, refreshReader } from '@silo/core';
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
): Promise<(ReaderContent & { capturedAt: string | null }) | undefined> {
  const stored = await getStoredReader(id);
  if (stored) return stored;
  const link = await getById(id);
  if (!link) return undefined;
  const live = await readLive({ id: link.id, url: link.url, sourceKind: link.sourceKind }, signal);
  return live ? { ...live, capturedAt: null } : undefined;
}

export function registerReaderRoutes(app: Hono): void {
  app.post('/links/:id/reader/refresh', async (c) => {
    const { id } = readerParams.parse(c.req.param());
    const result = await refreshReader(id);
    if (result.status === 'reader') return c.json(result.reader);
    if (result.status === 'refresh_unavailable') {
      return c.json(
        {
          error: result.status,
          message: 'Reader refresh needs the worker running in this process.',
        },
        503,
      );
    }
    const status = result.status === 'not_found' ? 404 : result.status === 'no_reader' ? 422 : 502;
    return c.json(
      {
        error: result.status,
        message:
          result.status === 'no_reader'
            ? 'No Reader content found on this page.'
            : result.status === 'fetch_failed'
              ? 'Could not fetch the page. Saved Reader kept.'
              : 'Link not found.',
      },
      status,
    );
  });
  app.get('/links/:id/reader', async (c) => {
    const { id } = readerParams.parse(c.req.param());
    const reader = await loadReader(id, c.req.raw.signal);
    if (!reader)
      return c.json({ error: 'not_found', message: 'No Reader content for this link' }, 404);
    return c.json(reader);
  });
}
