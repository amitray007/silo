import { exportLinks } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

/**
 * `GET /api/export` query schema (method file 027 U2): `format` selects the
 * export format, defaulting to `'json'` when the query param is absent
 * entirely. A PRESENT-but-invalid value (e.g. `?format=bogus`) fails Zod
 * parsing here at the edge -> the app's shared `onError` maps the thrown
 * `ZodError` to `400 validation_error`, exactly like every other route's
 * query validation (see `routes/links.ts`) — `core.exportLinks`'s own
 * `InvalidExportFormatError` throw is defense-in-depth only, never reached in
 * practice since this schema already rejects anything outside the enum.
 */
const exportQuerySchema = z.object({
  format: z.enum(['json', 'yaml', 'csv']).default('json'),
});

/**
 * Registers `GET /api/export` — a full-library download over `core.exportLinks`
 * (design spec: backup + feed-to-AI use case). Unlike every other route in
 * this package, the response body is NOT JSON: it's the ready-to-send file
 * body `core.exportLinks` already serialized, sent back with the matching
 * `Content-Type` and a `Content-Disposition: attachment` header so a browser
 * download (or `curl -O`) saves it as a dated file
 * (`silo-export-YYYY-MM-DD.<ext>`) rather than rendering it inline.
 */
export function registerExportRoutes(app: Hono): void {
  app.get('/export', async (c) => {
    const { format } = exportQuerySchema.parse(c.req.query());
    const result = await exportLinks({ format });

    const date = new Date().toISOString().slice(0, 10);
    c.header('Content-Type', result.contentType);
    c.header(
      'Content-Disposition',
      `attachment; filename="silo-export-${date}.${result.extension}"`,
    );
    return c.body(result.body);
  });
}
