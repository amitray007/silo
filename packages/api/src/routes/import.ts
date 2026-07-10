import { InvalidImportError, importLinks } from '@silo/core';
import type { Hono } from 'hono';
import { checkIngestAuth } from '../ingest-auth.js';

/**
 * Ceiling on the import request body size, in bytes. 25MB sits well above
 * any realistic personal-library export (see `core.MAX_IMPORT_LINKS`'s doc
 * comment for the matching link-count ceiling) while still bounding how much
 * an authenticated-but-hostile — or just fat-fingered — upload can force
 * this single-user server to buffer into memory before `core.importLinks`
 * even gets to validate the envelope.
 */
const MAX_IMPORT_BODY_BYTES = 25 * 1024 * 1024;

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
 * Body-size guard: deliberately NOT Hono's `bodyLimit` middleware. That
 * middleware would run BEFORE this handler and would itself read/buffer the
 * body ahead of the auth check below — meaning an UNAUTHENTICATED caller
 * could still force body buffering (and, worse, a byte-counting timing
 * signal) before ever being rejected. Auth must run strictly first, with
 * zero body access before it. So instead: the `content-length` header is
 * checked manually, AFTER `checkIngestAuth` passes, and rejected with 413
 * before `c.req.json()` is ever called. A caller who lies about
 * `content-length` (chunked encoding / no header) isn't caught by this
 * cheap pre-check, but IS still bounded by `core.MAX_IMPORT_LINKS` once the
 * body is parsed — this header check is a fast-path guard, not the only one.
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
    const auth = await checkIngestAuth(c);
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

    // Size guard runs AFTER auth, BEFORE any body read — see doc comment above.
    const contentLength = Number(c.req.header('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BODY_BYTES) {
      return c.json(
        { error: 'payload_too_large', message: 'Import body exceeds the maximum allowed size.' },
        413,
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
