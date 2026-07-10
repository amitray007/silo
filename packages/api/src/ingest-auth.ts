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

import { verifyAccessToken } from '@silo/core';
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
 * ASYNC (access-tokens slice, U2): now also accepts a non-revoked DB-backed
 * access token (`@silo/core`'s `verifyAccessToken`, a hash-lookup — hence the
 * `Promise`), not just the env `SILO_API_TOKEN`. Every caller (`routes/
 * ingest.ts`, `routes/import.ts`) must `await` this.
 *
 * DECISION — a valid DB token authorizes ingest EVEN IF `SILO_API_TOKEN` is
 * unset: this deliberately differs from `general-auth.ts`'s general gate,
 * where DB tokens only matter once the env token has turned the gate on
 * (`!expected` short-circuits before any DB lookup there). `/api/ingest` is
 * always-closed BY DESIGN (see this module's top doc comment — unset env
 * token still means 401, never "open on localhost"), so "the gate is on"
 * isn't a meaningful precondition here the way it is for the general gate.
 * A DB access token is an explicit, operator-created credential (minted via
 * the web UI's token management, itself gated behind `generalTokenAuth`) —
 * its mere existence IS the operator opting a caller into trusted-ingest
 * access, independent of whether they've ALSO set the env bootstrap secret.
 * Refusing a valid DB token here just because `SILO_API_TOKEN` happens to be
 * unset would make DB tokens a second-class credential for this one route,
 * with no security benefit (the token itself is still a 256-bit secret the
 * caller had to be handed) and a real usability cost (an operator who only
 * ever provisions DB tokens, never sets the env var, could never use
 * ingest/import at all). So: env token matches OR a valid DB token is
 * presented -> ok; DB tokens are checked on EVERY request here (not gated
 * behind `!!expected` first), unlike the general gate.
 *
 * Two failure modes, both a 401 at the call site, distinguished only for the
 * operator-facing log line (never leaked to the client — same discipline as
 * `app.ts`'s `onError`, which never exposes internal detail over HTTP):
 * - `token_not_configured`: the operator never set `SILO_API_TOKEN` on this
 *   process AND the presented bearer (if any) does not match a DB token
 *   either. The route is unconditionally closed, not "open on localhost".
 * - `missing_or_invalid_token`: a token IS configured, but the request
 *   didn't present a matching `Authorization: Bearer` header (env or DB).
 */
export async function checkIngestAuth(c: Context): Promise<IngestAuthResult> {
  const presented = bearerToken(c);
  const expected = configuredToken();

  if (presented && expected && timingSafeEqual(presented, expected)) {
    return { ok: true };
  }
  if (presented && (await verifyAccessToken(presented))) {
    return { ok: true };
  }

  if (!expected) {
    return { ok: false, reason: 'token_not_configured' };
  }
  return { ok: false, reason: 'missing_or_invalid_token' };
}
