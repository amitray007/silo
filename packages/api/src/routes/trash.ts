import { listTrash } from '@silo/core';
import type { Hono } from 'hono';
import { toTrashLinkJson } from '../link-json.js';
import { pageQuerySchema, toPageParams } from '../query-schemas.js';

/**
 * `GET /api/trash` — the whole Trash screen's data (plan 007, A2). Backed by
 * `core.listTrash` (C2), the ONE read deliberately NOT scoped through
 * `whereLive` — see `trash.ts`'s doc comment in `@silo/core`. A `list`/
 * `search` cursor handed here throws `InvalidCursorError` (mismatched `kind`
 * tag), mapped by the app's `onError` to `400 invalid_cursor` same as any
 * other malformed cursor.
 */
export function registerTrashRoutes(app: Hono): void {
  app.get('/trash', async (c) => {
    const query = pageQuerySchema.parse(c.req.query());
    const result = await listTrash(toPageParams(query));
    const links = result.links.map(toTrashLinkJson);
    return c.json(
      result.nextCursor === undefined ? { links } : { links, nextCursor: result.nextCursor },
    );
  });
}
