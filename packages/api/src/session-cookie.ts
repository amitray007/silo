import { SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, sessionSecret } from '@silo/core';
import type { Context } from 'hono';
import { getSignedCookie } from 'hono/cookie';

/**
 * Whether the request carries a valid, signed `silo_session` cookie.
 *
 * The single source of truth for "is the owner logged into the web app,"
 * shared by the general auth gate (`general-auth.ts`) and the OAuth consent
 * flow (`routes/oauth/authorize.ts`) so a user already logged into silo is
 * never re-prompted at consent. It lives in `@silo/api` (not `@silo/core`)
 * because it's Hono-`Context`-bound — core stays framework-free per
 * `docs/rules/architecture.md`; core owns only the secret + sentinel
 * primitives this composes over.
 *
 * Returns `false` (never throws) when the cookie is absent/tampered
 * (`getSignedCookie` returns `false` in either case) AND when `sessionSecret()`
 * is undefined — the latter only when NEITHER `SILO_SESSION_SECRET` nor
 * `SILO_APP_PASSWORD` is set, i.e. there is no cookie session to check at all.
 */
export async function hasValidSessionCookie(c: Context): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const value = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
  return value === SESSION_COOKIE_VALUE;
}
