import { addHighlight, deleteHighlight, editHighlight } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { toHighlightJson } from '../link-json.js';
import { addHighlightBodySchema, editHighlightBodySchema } from '../query-schemas.js';

const idParamSchema = z.object({ id: z.uuid() });

/**
 * Registers the passage-highlight routes over `core.addHighlight`,
 * `editHighlight` and `deleteHighlight`. Highlights come back on the
 * single-link read (`GET /api/links/:id`), so there is no list route.
 * Core owns the rules: bounds, quote matching, the feed-post guard (a `409`
 * through the app's error handler) and live-library scoping (`404`).
 */
export function registerHighlightsRoutes(app: Hono): void {
  /**
   * `POST /api/links/:id/highlights` — add a highlight. The web reader sends
   * `quote`, `prefix`, `suffix` and the offset hints; a quote-only body is
   * matched in the link's saved text (`occurrence` picks the nth match).
   * Returns `201 { highlight }`.
   */
  app.post('/links/:id/highlights', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = addHighlightBodySchema.parse(await c.req.json());
    const saved = await addHighlight(id, body);
    if (!saved) {
      return c.json({ error: 'not_found', message: `No live link with id ${id}` }, 404);
    }
    return c.json({ highlight: toHighlightJson(saved) }, 201);
  });

  /** `PATCH /api/highlights/:id` — change the colour and/or note. `note: null` clears it. Returns `{ highlight }`. */
  app.patch('/highlights/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = editHighlightBodySchema.parse(await c.req.json().catch(() => ({})));
    const updated = await editHighlight(id, body);
    if (!updated) {
      return c.json({ error: 'not_found', message: `No highlight with id ${id}` }, 404);
    }
    return c.json({ highlight: toHighlightJson(updated) });
  });

  /** `DELETE /api/highlights/:id` — delete one highlight. `204`; an unknown id is a `404`. */
  app.delete('/highlights/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    if (!(await deleteHighlight(id))) {
      return c.json({ error: 'not_found', message: `No highlight with id ${id}` }, 404);
    }
    return c.body(null, 204);
  });
}
