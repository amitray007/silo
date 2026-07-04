import { listTagsWithCounts } from '@silo/core';
import type { Hono } from 'hono';

/**
 * `GET /api/tags` — the sidebar's tag list with per-tag live-link counts
 * (plan 007, A2/C3), e.g. `[{ name: 'ai', count: 23 }, ...]` ordered by count
 * descending then name (see `core.listTagsWithCounts`'s doc comment for the
 * zero-count-omitted decision). A thin translation with no filtering/paging
 * of its own — the whole list is small enough (a personal store's tag count)
 * to return in one response.
 */
export function registerTagsRoutes(app: Hono): void {
  app.get('/tags', async (c) => {
    const tags = await listTagsWithCounts();
    return c.json({ tags });
  });
}
