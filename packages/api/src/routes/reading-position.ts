import { listReadingPositions, loadUrlCleaner } from '@silo/core';
import type { Hono } from 'hono';
import { readingPositionsQuerySchema } from '../query-schemas.js';

/** List saved places through the same core read as MCP. */
export function registerReadingPositionRoutes(app: Hono): void {
  app.get('/reading-positions', async (c) => {
    const input = readingPositionsQuerySchema.parse(c.req.query());
    const [page, cleaner] = await Promise.all([listReadingPositions(input), loadUrlCleaner()]);
    const positions = page.positions.map((row) => ({
      link: {
        id: row.link.id,
        title: row.link.title,
        url: cleaner(row.link.url),
        originalUrl: row.link.url,
      },
      position: row.position,
      source: row.source,
      updatedAt: row.updatedAt.toISOString(),
    }));
    return c.json({
      positions,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  });
}
