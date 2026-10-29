import { listTagsWithCounts, renameTag, tagTitleSchema } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { tagNameParamSchema } from '../query-schemas.js';

/**
 * `GET /api/tags` — the sidebar's tag list with per-tag live-link counts
 * (plan 007, A2/C3), e.g. `[{ name: 'ai', count: 23 }, ...]` ordered by count
 * descending then name (see `core.listTagsWithCounts`'s doc comment for the
 * zero-count-omitted decision). A thin translation with no filtering/paging
 * of its own — the whole list is small enough (a personal store's tag count)
 * to return in one response.
 */
export function registerTagsRoutes(app: Hono): void {
  app.patch('/tags/:name', async (c) => {
    const { name } = tagNameParamSchema.parse(c.req.param());
    const input = z
      .object({ name: tagTitleSchema, merge: z.boolean().default(false) })
      .parse(await c.req.json());
    const result = await renameTag(name, input.name, input.merge);
    if (!('error' in result)) return c.json(result);
    return c.json(
      {
        error: result.error,
        message:
          result.error === 'tag_exists'
            ? `The tag #${result.name} already exists. Confirm to merge the tags.`
            : 'Tag not found.',
        details: { name: result.name },
      },
      result.error === 'tag_exists' ? 409 : 404,
    );
  });
  app.get('/tags', async (c) => {
    const tags = await listTagsWithCounts();
    return c.json({ tags });
  });
}
