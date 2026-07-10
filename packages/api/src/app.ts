import { InvalidCursorError } from '@silo/core';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { corsMiddleware } from './cors.js';
import { generalTokenAuth } from './general-auth.js';
import { registerAccessTokenRoutes } from './routes/access-tokens.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCountsRoutes } from './routes/counts.js';
import { registerExportRoutes } from './routes/export.js';
import { registerFaviconRoutes } from './routes/favicon.js';
import { registerImportRoutes } from './routes/import.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerLinksRoutes } from './routes/links.js';
import { registerLinksWriteRoutes } from './routes/links-write.js';
import { registerPreviewImageRoutes } from './routes/preview-image.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTagsRoutes } from './routes/tags.js';
import { registerTrashRoutes } from './routes/trash.js';

/**
 * The API's error envelope — every non-2xx JSON body this API returns has
 * this shape. `error` is a short machine-stable code (`'invalid_cursor'`,
 * `'validation_error'`, `'not_found'`, `'internal_error'`, ...); `message` is
 * a human-readable summary; `details` is optional, structured extra context
 * (e.g. a Zod issue list) — present only when there's something useful to
 * attach. Documented here as the canonical description; `docs/rules/
 * api-hono.md` restates it for readers who start there instead.
 */
export type ErrorEnvelope = {
  error: string;
  message: string;
  details?: unknown;
};

function errorBody(error: string, message: string, details?: unknown): ErrorEnvelope {
  return details === undefined ? { error, message } : { error, message, details };
}

/**
 * Builds the silo HTTP API. Routes are registered here (A1 registered none —
 * `GET /health` and `GET /` only; A2 adds the `/api` read surface — `/links`,
 * `/links/search`, `/links/:id`, `/trash`, `/tags`, `/counts`; A3/A4 add the
 * write/lifecycle routes on top of this same factory). Each route is a thin
 * translation over an `@silo/core` function (`docs/rules/architecture.md`:
 * adapters do `HTTP request ↔ core call ↔ HTTP response`, never business
 * logic).
 *
 * The `/api` sub-app is a separate `Hono` instance mounted via `route('/api',
 * ...)` — each `registerXRoutes` function registers its paths on it
 * unprefixed (e.g. `app.get('/links', ...)` inside `registerLinksRoutes`
 * becomes reachable at `/api/links` once mounted). This keeps each routes
 * module free of repeating the `/api` prefix on every path.
 *
 * Returned UNSTARTED (no listening socket) — mirrors `@silo/mcp-server`'s
 * `createSiloMcpServer()`/`main.ts` split (see its doc comment): tests drive
 * this via Hono's built-in `app.request(...)` with no port needed, and only
 * `main.ts` owns turning it into a real listening process.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      name: 'silo',
      description: 'Agent-native personal link store — HTTP API',
      version: '0.0.0',
    }),
  );

  app.get('/health', (c) => c.json({ ok: true }));

  // `/api/auth/check` MUST be registered on the root app, BEFORE the `/api`
  // sub-app mount below — it is the ungated status probe the web app calls
  // to learn whether `SILO_API_TOKEN` is even configured, so it must stay
  // reachable with no bearer token even once `generalTokenAuth` (mounted on
  // the `api` sub-app) starts requiring one for everything else under
  // `/api/*`. Registering the exact path here means the root app's router
  // matches it directly and never delegates to the sub-app for this one path
  // (see `routes/auth.ts`'s doc comment; proven by `routes/auth.test.ts`).
  //
  // It stays OUTSIDE `generalTokenAuth` (the whole point — it must answer
  // without a token) but it goes THROUGH `corsMiddleware()` so its
  // response-exposure obeys the SAME origin allowlist as every other `/api/*`
  // route (ce-security review SEC-AUTHCHECK-CORS: keep the CORS boundary
  // uniform across the whole `/api` surface — a disallowed origin gets no CORS
  // headers here either, so the browser refuses to expose the boolean response
  // cross-origin, matching `/api/counts` et al). Defense-in-depth: the
  // timing-safe, boolean-only response already leaks no token material, but the
  // CORS boundary should not have a hole.
  app.use('/api/auth/check', corsMiddleware());
  registerAuthRoutes(app);

  const api = new Hono();
  // CORS first (the browser-facing gate — an allowlist-rejected origin gets
  // no CORS headers, so the browser refuses to expose the response, before
  // any route or the token gate ever runs), THEN the optional bearer-token
  // gate (the caller-identity gate — see `general-auth.ts`'s doc comment for
  // why this ordering matters and what each layer stops). `/api/ingest`'s
  // own always-closed gate (`ingest-auth.ts`) runs INSIDE its route handler,
  // independent of and in addition to this optional general gate.
  api.use('*', corsMiddleware());
  api.use('*', generalTokenAuth);
  registerLinksRoutes(api);
  registerLinksWriteRoutes(api);
  registerIngestRoutes(api);
  registerTrashRoutes(api);
  registerTagsRoutes(api);
  registerCountsRoutes(api);
  registerFaviconRoutes(api);
  registerPreviewImageRoutes(api);
  registerSettingsRoutes(api);
  registerExportRoutes(api);
  registerImportRoutes(api);
  registerAccessTokenRoutes(api);
  app.route('/api', api);

  app.notFound((c) => c.json(errorBody('not_found', 'Not found'), 404));

  app.onError((error, c) => {
    if (error instanceof InvalidCursorError) {
      return c.json(errorBody('invalid_cursor', error.message), 400);
    }
    if (error instanceof ZodError) {
      return c.json(errorBody('validation_error', 'Request validation failed', error.issues), 400);
    }
    // Unknown error: never leak internals (stack trace, DB error text) to the
    // client — log the real error to stderr for the operator, return a
    // sanitized, generic body.
    console.error('[silo/api] unhandled error:', error);
    return c.json(errorBody('internal_error', 'Internal server error'), 500);
  });

  return app;
}
