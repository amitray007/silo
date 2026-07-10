import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { InvalidCursorError } from '@silo/core';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { corsMiddleware } from './cors.js';
import { generalTokenAuth } from './general-auth.js';
import { registerAccessTokenRoutes } from './routes/access-tokens.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerCountsRoutes } from './routes/counts.js';
import { registerExportRoutes } from './routes/export.js';
import { registerFaviconRoutes } from './routes/favicon.js';
import { registerImportRoutes } from './routes/import.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerLinksRoutes } from './routes/links.js';
import { registerLinksWriteRoutes } from './routes/links-write.js';
import { registerLoginRoutes } from './routes/login.js';
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
 * This module's own directory, resolved from `import.meta.url` rather than
 * `process.cwd()` — used only to build the DEFAULT web-dist path below, so
 * that default is stable regardless of the directory a deployment happens to
 * launch the process from (the container sets `SILO_WEB_DIST` explicitly
 * anyway; this default only matters for a from-repo run without that env var
 * set, e.g. `pnpm --filter @silo/api start` after building web by hand).
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the web SPA's build output directory (deployable-silo spec, Unit
 * 1): `SILO_WEB_DIST` when set, else `packages/web/dist` resolved relative to
 * THIS package (`packages/api/src/../../web/dist`). Always returns an
 * ABSOLUTE path — `serveStatic`'s `root` option is resolved against
 * `process.cwd()` by default (see `@hono/node-server/serve-static`'s doc
 * comment), which would break the moment a deployment's working directory
 * isn't the repo root (e.g. a container launched from `/`), so this function
 * does that resolution itself once, here, rather than leaving it to the
 * static middleware.
 */
function resolveWebDistDir(): string {
  const raw = process.env.SILO_WEB_DIST;
  if (raw !== undefined && raw !== '') return resolve(raw);
  return resolve(MODULE_DIR, '../../web/dist');
}

/**
 * Reads the SPA shell HTML for the fallback response. Not cached: `index.html`
 * is tiny (a shell that loads hashed asset bundles, not the app itself), and
 * re-reading it per SPA-route request keeps this correct across a redeploy
 * that overwrites the dist directory without restarting the API process —
 * caching it at `createApp()` time would silently serve a stale shell after
 * such a redeploy until the next restart.
 */
function readIndexHtml(indexPath: string): string {
  return readFileSync(indexPath, 'utf-8');
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

  // Web dist resolved ONCE per app build (not per-request) — matches how
  // `corsMiddleware()`'s allowlist is captured at `createApp()` time (see its
  // doc comment). A built deployment sets `SILO_WEB_DIST` once for the
  // process lifetime; re-checking per request would only add a `statSync`
  // per hit for no behavioral benefit.
  const webDistDir = resolveWebDistDir();
  const webIndexPath = join(webDistDir, 'index.html');
  const hasWebBuild = existsSync(webIndexPath);

  // `GET /` reconciliation (Unit 1, deployable-silo spec): in a built
  // deployment (web dist present) `/` should serve the SPA shell so a bare
  // domain visit loads the app, not a JSON banner. But this same factory is
  // also what every existing api test drives directly via `createApp()` with
  // no dist built (`app.test.ts` asserts the JSON banner) — so the banner
  // stays the fallback whenever `index.html` isn't actually there, rather
  // than assuming a deployment context. Implemented by only registering the
  // JSON-banner handler when there's no web build to serve; when one exists,
  // `/` is left unmatched here and falls through to the static+SPA catch-all
  // registered below (after the `/api` mount), which serves `index.html` for
  // `/` the same way it does for any other unmatched SPA route.
  if (!hasWebBuild) {
    app.get('/', (c) =>
      c.json({
        name: 'silo',
        description: 'Agent-native personal link store — HTTP API',
        version: '0.0.0',
      }),
    );
  }

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

  // `/api/login`/`/api/logout` (web-auth cookie upgrade, Unit 2) sit
  // alongside `/api/auth/check` for the same reason: they must be reachable
  // OUTSIDE `generalTokenAuth` (login is how a credential is first
  // obtained; logout must succeed even against a stale session) but still go
  // THROUGH `corsMiddleware()` so their response-exposure obeys the same
  // origin allowlist as the rest of `/api/*` (mirrors `/api/auth/check`'s
  // CORS rationale above — see `routes/login.ts`'s doc comment for the
  // route bodies).
  app.use('/api/login', corsMiddleware());
  app.use('/api/logout', corsMiddleware());
  registerLoginRoutes(app);

  // `/api/config` (deployable-silo slice, Unit 4) — an ungated PUBLIC probe
  // (the operator's MCP URL, not a secret), registered on the root app for the
  // same reason as `/api/auth/check`: the "Copy config" button must read it
  // pre-login. CORS-wrapped to keep the origin allowlist uniform across `/api/*`.
  app.use('/api/config', corsMiddleware());
  registerConfigRoutes(app);

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

  // Web SPA static serve + client-route fallback (Unit 1, deployable-silo
  // spec) — registered LAST, after the `/api` mount above, so `/api/*` keeps
  // matching the sub-app (and its own 404s) first; Hono's router returns the
  // FIRST matching handler for a given path (verified empirically — a
  // wildcard registered before a specific route wins over it), so registration
  // ORDER here is load-bearing, not cosmetic. GRACEFUL DEGRADE: when no web
  // build exists (dev, or any test driving `createApp()` directly with
  // `SILO_WEB_DIST` unset/pointing nowhere), NOTHING is registered here at
  // all — the API behaves exactly as before this unit, falling through to
  // `app.notFound`'s JSON 404 for every unmatched GET, same as today.
  if (hasWebBuild) {
    // Serves any request whose path matches a real file under `webDistDir`
    // (JS/CSS/image assets, `/favicon.ico`, etc.) — falls through to `next()`
    // (does NOT respond) when no file matches, per `serveStatic`'s own
    // contract (see `@hono/node-server/serve-static`'s source: `onNotFound`
    // + `next()`), so the SPA-fallback handler below still runs for a client
    // route like `/trash` that isn't a real file on disk.
    app.use('*', serveStatic({ root: webDistDir }));

    // SPA fallback: any GET that reached here matched neither an `/api/*`
    // route above nor a real static file — for a client-side route (e.g.
    // `/trash`, `/tags/foo`) that's expected; hand back `index.html` so the
    // SPA's own router (not this server) resolves the path. Scoped to GET
    // only and explicitly excludes `/api/*` and `/health` so an unknown
    // `/api/...` route still falls through to `app.notFound`'s JSON 404
    // rather than being shadowed by HTML — those two prefixes should never
    // reach this handler in practice (both are matched by earlier routes/the
    // `/api` sub-app first), but the guard is kept explicit rather than
    // relying solely on registration order, since "an unknown API route
    // returns HTML" would be a silent, easy-to-miss regression.
    app.get('*', (c, next) => {
      const path = c.req.path;
      if (path.startsWith('/api/') || path === '/api' || path === '/health') {
        return next();
      }
      return c.html(readIndexHtml(webIndexPath));
    });
  }

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
