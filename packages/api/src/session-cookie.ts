import { SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, sessionSecret } from '@silo/core';
import type { Context } from 'hono';
import { getSignedCookie } from 'hono/cookie';

/** The HTTPS-only cookie used when Silo is embedded cross-site. Keeping this
 * adapter detail here lets the core continue to own only the session secret
 * and sentinel. */
export const EMBEDDED_SESSION_COOKIE_NAME = '__Host-silo_embed_session';

export function isHttpsRequest(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
}

async function hasValidCookie(c: Context, name: string): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const value = await getSignedCookie(c, secret, name);
  return value === SESSION_COOKIE_VALUE;
}

/** Whether the request carries the regular first-party session cookie. OAuth
 * intentionally uses this narrower check to retain its existing session
 * behavior. */
export function hasValidRegularSessionCookie(c: Context): Promise<boolean> {
  return hasValidCookie(c, SESSION_COOKIE_NAME);
}

/**
 * Whether the request carries either valid signed session cookie.
 *
 * The single source of truth for "is the owner logged into the web app,"
 * shared by the general auth gate (`general-auth.ts`) and auth-state probe.
 * OAuth uses `hasValidRegularSessionCookie` so its existing regular-session
 * behavior remains unchanged. This module lives in `@silo/api` (not `@silo/core`)
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
  return (
    (await hasValidRegularSessionCookie(c)) ||
    (await hasValidCookie(c, EMBEDDED_SESSION_COOKIE_NAME))
  );
}
