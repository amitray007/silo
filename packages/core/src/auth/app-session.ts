/**
 * Web-login primitives for the human "app password" + signed session cookie
 * upgrade (`docs/superpowers/specs/2026-07-11-web-auth-cookie-upgrade.md`,
 * Unit 1). Separate secret from `SILO_API_TOKEN` (the machine token
 * extensions/MCP/CLI use): a human logging into the web UI types a
 * dedicated `SILO_APP_PASSWORD` once, which the API layer (Unit 2/3)
 * exchanges for a signed, HTTP-only `silo_session` cookie — never
 * XSS-readable the way a `sessionStorage` token would be.
 *
 * This module only owns the PASSWORD check + the signing SECRET + the
 * cookie's shared constants. The actual cookie signing/verification
 * (`setSignedCookie`/`getSignedCookie`) is Hono's own HMAC machinery, used
 * at the `@silo/api` edge (Unit 2/3) — core stays free of Hono, per
 * `docs/rules/architecture.md`'s adapter boundary (core may not depend on
 * an adapter's HTTP framework). Reuses `token.ts`'s `readTokenEnv`/
 * `timingSafeEqual` rather than reimplementing either.
 */

import { readTokenEnv, timingSafeEqual } from './token.js';

/** Reads `SILO_APP_PASSWORD` fresh from the environment on every call (same
 * "not cached at module load" discipline as `readTokenEnv` itself) — so a
 * test that sets/unsets `process.env` between cases, or an operator setting
 * it via a process manager after boot, observes the change without a module
 * reload. Unset OR empty string both read as "no password configured"
 * (`undefined`) — the web login screen never renders in that state. */
export function readAppPassword(): string | undefined {
  return readTokenEnv('SILO_APP_PASSWORD');
}

/** Timing-safe compare of a candidate password against the configured
 * `SILO_APP_PASSWORD`. Returns `false` when no password is configured —
 * there is nothing a candidate could ever correctly match, so login is
 * simply inapplicable rather than "always wrong" (the caller, Unit 2's
 * `POST /api/login`, turns the unset case into its own 400 rather than
 * reaching this function at all — see that route's doc comment). Delegates
 * the actual comparison to `timingSafeEqual` (same rationale as a bearer
 * token: a password is a secret, so `===` would leak how many leading bytes
 * matched via response timing). */
export function verifyAppPassword(candidate: string): boolean {
  const expected = readAppPassword();
  if (!expected) return false;
  return timingSafeEqual(candidate, expected);
}

/** The secret Hono's `setSignedCookie`/`getSignedCookie` HMAC the
 * `silo_session` cookie with. `SILO_SESSION_SECRET` wins when set (a
 * deployment that wants the signing key independent of the login password —
 * e.g. so rotating one doesn't rotate the other); otherwise falls back to
 * `SILO_APP_PASSWORD` itself, so a single-secret deployment (just set the
 * password) Just Works with no second env var required. `undefined` only
 * when NEITHER is set — the caller (Unit 2/3) never reaches the cookie path
 * in that state, since an unset password already means "no login" and thus
 * no session to sign. */
export function sessionSecret(): string | undefined {
  return readTokenEnv('SILO_SESSION_SECRET') ?? readAppPassword();
}

/** The `silo_session` cookie's name — shared by the login/logout routes
 * (Unit 2, which set/clear it) and the general gate + `/api/auth/check`
 * (Unit 3, which read it), so all four call sites can never drift on what
 * the cookie is called. */
export const SESSION_COOKIE_NAME = 'silo_session';

/** The cookie's signed VALUE. Deliberately not a per-user identity (silo is
 * single-user) — it's a constant sentinel whose *signature* is the proof:
 * only the process holding `sessionSecret()` could have produced a
 * signature that verifies against this exact string, so a verified
 * `getSignedCookie` result matching this constant IS the authentication.
 * Stateless — no DB-backed session table, no revocation list (see the spec's
 * "Non-goals": rotate the secret to invalidate every outstanding session). */
export const SESSION_COOKIE_VALUE = 'ok';

/** The cookie's `Max-Age` in seconds — a fixed ~30-day session (no
 * "remember me" toggle; see the spec's "Non-goals"). `30 * 24 * 60 * 60`
 * spelled out as a literal so the value is inspectable without doing the
 * arithmetic. */
export const SESSION_MAX_AGE_SECONDS = 2592000;
