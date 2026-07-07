/**
 * The trust gate for `POST /api/ingest` (CLI foundation slice, plan 020).
 *
 * THE GUARANTEE: `sourceData` injection at capture time is possible ONLY from
 * a caller that presents the exact `SILO_API_TOKEN` configured on this
 * process, via `Authorization: Bearer <token>`. There is no other way in.
 *
 * WHY TOKEN-ALWAYS, NOT "loopback-trusted, token-required-when-exposed"
 * (the plan's preferred design): that design needs a reliable way to tell a
 * loopback caller from a remote one. `@hono/node-server`'s `getConnInfo`
 * helper (the only such signal available here) reads
 * `c.env.incoming.socket.remoteAddress` — a real Node `IncomingMessage`
 * socket that exists ONLY when the app is served by `@hono/node-server`'s
 * `serve()`. This package's OWN testing convention (`docs/rules/api-hono.md`
 * — "tests drive `createApp()` directly via Hono's built-in
 * `app.request(...)`, no port, no real socket, no process") means every
 * integration test in this repo constructs requests with no underlying
 * socket at all — `getConnInfo` would throw reading `.socket` of `undefined`
 * on every single one of them, making the loopback branch of the trust gate
 * impossible to exercise via this codebase's real test harness (the
 * documented, only, way `@silo/api` is tested). A trust boundary that can't
 * be exercised by the project's own test pattern is not one this slice will
 * ship. Socket-based loopback detection is also spoofable-adjacent in a way
 * a bearer token isn't (proxies, port-forwards, and container NAT can all
 * make a genuinely remote request arrive looking loopback-local) — the
 * plan's own fallback for this situation is explicit: "if [loopback
 * detection] is unreliable, fall back to: require SILO_API_TOKEN for
 * /api/ingest always + document it." That is what this module implements.
 *
 * OPERATIONAL CONSEQUENCE (documented per the plan's requirement): unlike
 * the rest of this API (see `docs/rules/api-hono.md`'s "Auth (there is
 * none)" section — still true for every OTHER route), `/api/ingest`
 * requires `SILO_API_TOKEN` to be set on the API process EVEN on a default
 * loopback-only local dev setup. `.env.example` documents this. There is no
 * silent no-auth path for this one route: if the token is unset, the route
 * always returns 401 (see `requireIngestToken`) — the endpoint is closed by
 * default until a caller (the ingest CLI) is explicitly authorized, rather
 * than open until someone remembers to lock it down.
 */

import type { Context } from 'hono';
import { bearerToken, readTokenEnv, timingSafeEqual } from './token-auth.js';

/** Reads `SILO_API_TOKEN` fresh from the environment on every call — see
 * `token-auth.ts`'s `readTokenEnv` doc comment for why this isn't cached at
 * module load. */
function configuredToken(): string | undefined {
  return readTokenEnv('SILO_API_TOKEN');
}

export type IngestAuthResult =
  | { ok: true }
  | { ok: false; reason: 'token_not_configured' | 'missing_or_invalid_token' };

/**
 * Checks whether `c`'s request is authorized to call `/api/ingest`. Pure
 * (no response-writing) so the route handler stays in control of the exact
 * error envelope — see `routes/ingest.ts`.
 *
 * Two failure modes, both a 401 at the call site, distinguished only for the
 * operator-facing log line (never leaked to the client — same discipline as
 * `app.ts`'s `onError`, which never exposes internal detail over HTTP):
 * - `token_not_configured`: the operator never set `SILO_API_TOKEN` on this
 *   process. The route is unconditionally closed, not "open on localhost".
 * - `missing_or_invalid_token`: a token IS configured, but the request
 *   didn't present a matching `Authorization: Bearer` header.
 */
export function checkIngestAuth(c: Context): IngestAuthResult {
  const expected = configuredToken();
  if (!expected) {
    return { ok: false, reason: 'token_not_configured' };
  }
  const presented = bearerToken(c);
  if (!presented || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'missing_or_invalid_token' };
  }
  return { ok: true };
}
