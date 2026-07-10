import {
  readAppPassword,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  SESSION_MAX_AGE_SECONDS,
  sessionSecret,
  verifyAppPassword,
} from '@silo/core';
import type { Context, Hono } from 'hono';
import { deleteCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';

/** `POST /api/login` body schema — a password only. */
const loginBodySchema = z.object({
  password: z.string(),
});

/** Whether THIS request arrived over HTTPS — decides the cookie's `Secure`
 * attribute. Checked from the request URL's own protocol first (works when
 * Hono is served directly over TLS); falls back to `x-forwarded-proto:
 * https` (the standard signal a reverse proxy/load balancer sets when IT
 * terminates TLS and forwards plain HTTP to this process — the common prod
 * shape). Deliberately NOT hardcoded: a plain-http localhost dev server must
 * get a non-Secure cookie, or the browser would silently refuse to ever send
 * it back (a Secure cookie is never sent over an insecure connection),
 * breaking login in dev. */
function isHttpsRequest(c: Context): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true;
  return c.req.header('x-forwarded-proto') === 'https';
}

/**
 * Registers the human web-login routes (web-auth cookie upgrade, Unit 2):
 * `POST /api/login` exchanges the shared `SILO_APP_PASSWORD` for a signed,
 * HTTP-only `silo_session` cookie; `POST /api/logout` clears it. Mounted on
 * the ROOT app in `app.ts`, next to `registerAuthRoutes` — NOT the `/api`
 * sub-app that carries `generalTokenAuth` (`app.ts`) — because login itself
 * must be reachable with no existing credential (that's the whole point:
 * these routes are how a credential is first obtained), and logout should
 * always succeed even against a stale/invalid session. Both paths are
 * CORS-wrapped in `app.ts` exactly like `/api/auth/check`, so the browser
 * enforces the same origin allowlist here as the rest of `/api/*`.
 *
 * See `@silo/core`'s `auth/app-session.ts` for the password-verify + cookie
 * secret/name/value/max-age primitives this module composes over Hono's
 * `setSignedCookie`/`deleteCookie` — core stays free of Hono per
 * `docs/rules/architecture.md`'s adapter boundary, so the actual cookie
 * mechanics live here, at the edge.
 */
export function registerLoginRoutes(app: Hono): void {
  /**
   * `POST /api/login` — body `{ password }`. Three outcomes:
   * - No `SILO_APP_PASSWORD` configured at all: `400` (login is simply not
   *   applicable on this deployment — the web UI never shows a login screen
   *   or calls this route in that state; a request here anyway is a
   *   misconfigured/confused caller, not an auth failure, hence 400 not 401).
   * - Wrong password: `401 { error: 'unauthorized' }`, matching the same
   *   envelope shape `general-auth.ts` returns for a bad bearer token — no
   *   cookie is set.
   * - Correct password: sign + set the `silo_session` cookie (`HttpOnly`,
   *   `SameSite=Lax`, `Path=/`, `Secure` iff this request is HTTPS, ~30-day
   *   `Max-Age`) and return `200 { ok: true }`.
   */
  app.post('/api/login', async (c) => {
    const { password } = loginBodySchema.parse(await c.req.json());

    if (!readAppPassword()) {
      return c.json(
        { error: 'not_applicable', message: 'No SILO_APP_PASSWORD is configured.' },
        400,
      );
    }

    if (!verifyAppPassword(password)) {
      return c.json({ error: 'unauthorized', message: 'Incorrect password.' }, 401);
    }

    // `sessionSecret()` is guaranteed defined here: it falls back to
    // `readAppPassword()` (see app-session.ts), and the `!readAppPassword()`
    // guard above already returned before this point — so a password IS
    // configured, and `sessionSecret()` can only be undefined when NEITHER
    // secret is set.
    const secret = sessionSecret();
    if (!secret) {
      throw new Error('sessionSecret() unexpectedly undefined with SILO_APP_PASSWORD set');
    }

    await setSignedCookie(c, SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, secret, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: isHttpsRequest(c),
    });
    return c.json({ ok: true });
  });

  /**
   * `POST /api/logout` — clears the `silo_session` cookie and always
   * returns `200 { ok: true }`, even if no session cookie was present (a
   * double logout, or logging out on a deployment with no password
   * configured, is a harmless no-op rather than an error).
   */
  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
  });
}
