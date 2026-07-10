/**
 * The OPTIONAL auth gate for the general API (extensions-base slice, plan
 * 021; extended by the web-auth cookie upgrade) — the "prod seam" the
 * Chrome/Raycast extensions, MCP/CLI, and a deployed web UI all use once
 * silo runs somewhere other than localhost.
 *
 * POSTURE (deliberately the OPPOSITE default of `ingest-auth.ts`): WHEN
 * NEITHER `SILO_API_TOKEN` NOR `SILO_APP_PASSWORD` is set, this gate is a
 * no-op — every `/api/*` route (except `/api/ingest`, which has its own
 * always-closed gate) stays exactly as reachable as it is today (see
 * `docs/rules/api-hono.md`'s "Auth (there is none)"). This is the correct
 * default for a single-user localhost tool: a developer running `pnpm dev`
 * with neither secret configured must see NO change in behavior. Only WHEN
 * an operator explicitly sets EITHER secret does every `/api/*` route start
 * requiring a credential — see the three-branch order below. (Rationale for
 * "either, not both": a deployment that sets a web password clearly wants
 * the API protected too, and the web UI's own `/api/*` calls must be gated
 * or the password would be pointless — see the spec's "Relationship between
 * the two secrets" table.)
 *
 * THREE CREDENTIAL BRANCHES, IN ORDER:
 * 1. `Authorization: Bearer <SILO_API_TOKEN>` (env token, timing-safe
 *    compare) — extensions/MCP/CLI's bootstrap credential, unchanged from
 *    plan 021.
 * 2. `Authorization: Bearer <DB token>` (`@silo/core`'s `verifyAccessToken`,
 *    hash-lookup) — named tokens minted from the web Access tab, unchanged
 *    from the access-tokens slice.
 * 3. A valid signed `silo_session` cookie (`getSignedCookie` against
 *    `sessionSecret()`, verifying to the sentinel `SESSION_COOKIE_VALUE`) —
 *    the human web-login session (web-auth cookie upgrade, Unit 3, NEW).
 *    Only reachable when a password is configured (`sessionSecret()` is
 *    undefined otherwise — see the guard in the implementation below), so a
 *    deployment that sets ONLY `SILO_API_TOKEN` never evaluates this branch
 *    at all: it behaves exactly as it did before this upgrade.
 *
 * Each branch is tried only after the previous one fails, so the common
 * case (env token, or the gate off entirely) never pays for a DB round-trip
 * or a cookie-signature verification it doesn't need.
 *
 * SHARED MECHANICS: reuses `token-auth.ts`'s timing-safe compare and
 * Bearer-header parsing — see that module's doc comment for why a naive
 * `===` is unsafe for comparing secrets. Only the env var name(s) and the
 * open/closed default differ between this gate and `ingest-auth.ts`; that
 * policy difference stays local to each gate's own module.
 *
 * `GET /health` is mounted OUTSIDE the `/api` sub-app (see `app.ts`) so it is
 * already exempt by construction — this middleware is only ever attached to
 * the `/api` sub-app, never the root app, so `/health` never passes through
 * it at all.
 */

import {
  readAppPassword,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  sessionSecret,
  verifyAccessToken,
} from '@silo/core';
import type { Context, Next } from 'hono';
import { getSignedCookie } from 'hono/cookie';
import { bearerToken, readTokenEnv, timingSafeEqual } from './token-auth.js';

/** Reads `SILO_API_TOKEN` fresh from the environment on every call — mirrors
 * `ingest-auth.ts`'s `configuredToken`; kept as a separate tiny wrapper
 * (rather than calling `readTokenEnv` inline at each call site) so a future
 * change to which env var the general gate reads touches one line. */
function configuredToken(): string | undefined {
  return readTokenEnv('SILO_API_TOKEN');
}

/** Whether a valid, signed `silo_session` cookie is present on this request.
 * Returns `false` (never throws) both when the cookie is absent/tampered
 * (`getSignedCookie` itself returns `false` in either case) AND when
 * `sessionSecret()` is undefined — the latter only happens when NEITHER
 * `SILO_SESSION_SECRET` nor `SILO_APP_PASSWORD` is set, in which case there
 * is no cookie session to check at all (a deployment gated purely by
 * `SILO_API_TOKEN` never reaches Hono's signing call with an undefined
 * secret). */
async function hasValidSessionCookie(c: Context): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const value = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
  return value === SESSION_COOKIE_VALUE;
}

/**
 * Hono middleware: when `SILO_API_TOKEN` or `SILO_APP_PASSWORD` is set,
 * every request must present a valid credential (env bearer, DB bearer, or
 * session cookie — see the module doc comment's three branches) or gets
 * `401`. When NEITHER is set, calls `next()` immediately — no auth, exactly
 * today's behavior.
 *
 * Mount this AFTER the CORS middleware on the `/api` sub-app (see `app.ts`)
 * so the ordering is: disallowed origin -> blocked by CORS (no CORS headers,
 * browser refuses the response) before this middleware ever runs; allowed
 * origin + no/bad credential -> this middleware's `401`.
 */
export async function generalTokenAuth(c: Context, next: Next): Promise<Response | undefined> {
  const expected = configuredToken();
  const authConfigured = expected !== undefined || readAppPassword() !== undefined;
  if (!authConfigured) {
    await next();
    return undefined;
  }

  const presented = bearerToken(c);
  if (expected && presented && timingSafeEqual(presented, expected)) {
    await next();
    return undefined;
  }
  if (presented && (await verifyAccessToken(presented))) {
    await next();
    return undefined;
  }
  if (await hasValidSessionCookie(c)) {
    await next();
    return undefined;
  }
  return c.json(
    {
      error: 'unauthorized',
      message: 'A valid Authorization: Bearer token or an active session is required.',
    },
    401,
  );
}
