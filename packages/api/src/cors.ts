/**
 * The CORS allowlist for `/api/*` (extensions-base slice, plan 021) — the
 * browser-facing trust gate the Chrome extension (and, later, a deployed web
 * UI on a different origin than the API) needs to call this API
 * cross-origin.
 *
 * THE SECURITY BOUNDARY: the allowlist IS the boundary. This API has no
 * general auth by default (see `docs/rules/api-hono.md`'s "Auth (there is
 * none)") — on a default local setup, ANY origin a victim's browser can be
 * made to visit could otherwise read/write/delete the whole store via
 * credentialed or even credential-less cross-origin fetches, if the browser
 * were told those responses are readable. CORS is what tells the BROWSER
 * whether to expose a cross-origin response's body to the calling page's
 * JS — an allowlist of exactly the origins we trust (our own web UI in dev,
 * our own extension ids in prod) is what prevents an arbitrary third-party
 * page from reading responses even though the HTTP request itself still
 * physically reaches the server (CORS is not a server-side request
 * blocker — see the module-level test suite for what it does and doesn't
 * stop). `Access-Control-Allow-Origin: *` would defeat this entirely (any
 * page, anywhere, could read any response) — this module can NEVER emit
 * `*`, by construction: it only ever echoes back an origin that is an exact
 * match against the configured allowlist (Hono's `cors` origin-callback
 * form), never a wildcard string.
 *
 * CONFIGURATION: `SILO_ALLOWED_ORIGINS` (comma-separated). UNSET -> safe
 * localhost defaults (`http://localhost:5173` — the web UI's Vite dev
 * server per `packages/web`'s dev script — and `http://localhost:8787` —
 * this API's own default port, for tooling that treats the API as its own
 * origin). SET -> exactly the configured list, nothing implicit added (a
 * production deployment must list every trusted origin explicitly,
 * including `chrome-extension://<id>` for the packed extension and the
 * deployed web UI's real origin).
 */

import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:8787'];

/** Comma-separated `SILO_ALLOWED_ORIGINS` -> a trimmed, non-empty origin
 * list. Exported for tests; also used by `corsMiddleware` below. Falls back
 * to `DEFAULT_ALLOWED_ORIGINS` when the env var is unset OR set to an
 * empty/whitespace-only string (an operator who unsets it shouldn't
 * accidentally lock out even localhost). */
export function readAllowedOrigins(): string[] {
  const raw = process.env.SILO_ALLOWED_ORIGINS;
  if (raw === undefined) return DEFAULT_ALLOWED_ORIGINS;
  const parsed = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Builds the CORS middleware for the `/api` sub-app. Reads
 * `SILO_ALLOWED_ORIGINS` fresh each time it's called (not cached at module
 * load, same discipline as `token-auth.ts`'s `readTokenEnv`) — `createApp()`
 * calls this once per app build, so a test that sets/unsets the env var
 * between `createApp()` calls (rather than between requests on the SAME
 * app instance) observes the change; this matches how the allowlist is
 * actually configured in practice (a fixed env var for the lifetime of one
 * process).
 *
 * `origin` is Hono's callback form, not a static list: given the
 * requester's `Origin` header, return it verbatim to allow (Hono then
 * emits it as `Access-Control-Allow-Origin`, an exact echo — never `*`), or
 * `undefined`/`null` to deny (Hono then omits CORS headers entirely, which
 * makes the browser block the calling page from reading the response, even
 * though the request itself still reached the server — see this module's
 * doc comment). A request with NO `Origin` header (same-origin browser
 * navigation, curl, server-to-server calls) isn't a CORS request at all —
 * the browser never applies CORS to same-origin calls, and non-browser
 * callers ignore CORS headers entirely — so `origin` being `''` here (no
 * match in the allowlist) correctly denies nothing that mattered: same-
 * origin/non-browser callers were never gated by CORS to begin with.
 *
 * Methods: GET/POST/PATCH/DELETE (the full verb surface this API uses —
 * see `docs/rules/api-hono.md`'s route table). Headers: `Content-Type`
 * (every JSON body) + `Authorization` (so the general bearer token —
 * `general-auth.ts` — can be sent cross-origin once a deployment sets
 * `SILO_API_TOKEN`).
 */
export function corsMiddleware(): MiddlewareHandler {
  return cors({
    origin: (origin) => {
      const allowed = readAllowedOrigins();
      return allowed.includes(origin) ? origin : undefined;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
}
