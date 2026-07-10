import { InvalidImportError, importLinks } from '@silo/core';
import type { Hono } from 'hono';
import { checkIngestAuth } from '../ingest-auth.js';

/**
 * `POST /api/import` — restores a silo `version: 1` JSON export (produced by
 * `GET /api/export`) back into the store, over `core.importLinks` (import
 * method file, U2). Success returns the `ImportResult` summary
 * (`{version, total, created, merged, skipped}`) as the response body.
 *
 * TOKEN-GATED, same treatment as `POST /api/ingest`
 * (`ingest-auth.ts`/`routes/ingest.ts`): an import file's `sourceData` field
 * is caller-supplied, unverified metadata — the same injection surface
 * `/api/ingest` exists to close off — so this route reuses that route's
 * ALWAYS-CLOSED gate verbatim (`checkIngestAuth`, unset `SILO_API_TOKEN` ⇒
 * 401 on every request, never falls open on a default loopback setup) and
 * its generic-401 response discipline: `auth.reason` (`token_not_configured`
 * vs `missing_or_invalid_token`) is logged server-side only, never leaked in
 * the response body, so a prober can't learn whether import is enabled at
 * all on a reachable-but-unauthenticated host.
 *
 * Body parsing is manual (`c.req.json().catch(...)`) rather than Hono's
 * usual "let a thrown `SyntaxError` fall to `onError`" — `core.importLinks`
 * takes `unknown` and does its OWN Zod validation of the parsed envelope
 * (`InvalidImportError` on a bad shape), so this route needs to distinguish
 * "not valid JSON at all" (400 here, before ever calling core) from
 * "valid JSON, invalid envelope" (400 via the `InvalidImportError` catch
 * below) — both land on `400 validation_error`, just via two different
 * paths, mirroring how `core.importLinks`'s own doc comment splits envelope-
 * level failure from per-link failure.
 */
export function registerImportRoutes(app: Hono): void {
  app.post('/import', async (c) => {
    const auth = checkIngestAuth(c);
    if (!auth.ok) {
      // Same generic-401 discipline as routes/ingest.ts: never distinguish
      // "token not configured" from "wrong/missing token" in the RESPONSE —
      // the operator-relevant detail stays server-side, in the log line only.
      console.error(`[silo/api] /api/import rejected: ${auth.reason}`);
      return c.json(
        { error: 'unauthorized', message: 'A valid Authorization: Bearer token is required.' },
        401,
      );
    }

    const payload = await c.req.json().catch(() => null);
    if (payload === null) {
      return c.json({ error: 'validation_error', message: 'Request body is not valid JSON.' }, 400);
    }

    try {
      const result = await importLinks(payload);
      return c.json(result);
    } catch (error) {
      if (error instanceof InvalidImportError) {
        return c.json({ error: 'validation_error', message: error.message }, 400);
      }
      throw error;
    }
  });
}
