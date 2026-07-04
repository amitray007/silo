import { getCounts, PURGE_WINDOW_DAYS } from '@silo/core';
import type { Hono } from 'hono';

/**
 * `GET /api/counts` — the sidebar's live/trash counts plus the read-only
 * purge window (plan 007, A2/C2/C4), e.g. `{ live: 128, trash: 2,
 * purgeWindowDays: 30 }`. `PURGE_WINDOW_DAYS` is a core constant (not a
 * settings store — C4 scoped that out; the mockup's 7/30/90 cycle picker is
 * deferred to a later settings slice), so it's read directly rather than
 * queried.
 */
export function registerCountsRoutes(app: Hono): void {
  app.get('/counts', async (c) => {
    const counts = await getCounts();
    return c.json({ ...counts, purgeWindowDays: PURGE_WINDOW_DAYS });
  });
}
