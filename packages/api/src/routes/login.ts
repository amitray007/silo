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
import { csrfFailure } from '../csrf.js';
import { EMBEDDED_SESSION_COOKIE_NAME, isHttpsRequest } from '../session-cookie.js';

/** `POST /api/login` body schema — a password only. */
const loginBodySchema = z.object({
  password: z.string(),
  embedded: z.boolean().optional(),
});

async function setLoginSession(c: Context, secret: string, embedded: boolean): Promise<void> {
  await setSignedCookie(
    c,
    embedded ? EMBEDDED_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME,
    SESSION_COOKIE_VALUE,
    secret,
    {
      httpOnly: true,
      sameSite: embedded ? 'None' : 'Lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: embedded || isHttpsRequest(c),
      ...(embedded ? { partitioned: true } : {}),
    },
  );
}

/**
 * Registers the human web-login routes (web-auth cookie upgrade, Unit 2):
 * `POST /api/login` exchanges the shared `SILO_APP_PASSWORD` for a signed,
 * HTTP-only first-party or embedded session cookie; `POST /api/logout` clears
 * both. Mounted on
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
   * `POST /api/login` — body `{ password, embedded?: boolean }`. It requires
   * `X-Silo-CSRF: 1`; regular login mints `silo_session` with `SameSite=Lax`,
   * while HTTPS embedded login mints the partitioned `__Host-silo_embed_session`.
   * Three outcomes:
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
    c.header('Cache-Control', 'no-store');
    const csrf = csrfFailure(c);
    if (csrf) return csrf;
    const { password, embedded = false } = loginBodySchema.parse(await c.req.json());

    if (embedded && !isHttpsRequest(c)) {
      return c.json(
        {
          error: 'embedded_login_requires_https',
          message:
            'Embedded login requires HTTPS. Open Silo directly or use HTTPS through the proxy.',
        },
        400,
      );
    }

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

    await setLoginSession(c, secret, embedded);
    return c.json({ ok: true });
  });

  /**
   * `POST /api/logout` requires `X-Silo-CSRF: 1`, clears both session cookies,
   * and returns `200 { ok: true }` even if neither cookie was present.
   */
  app.post('/api/logout', (c) => {
    c.header('Cache-Control', 'no-store');
    const csrf = csrfFailure(c);
    if (csrf) return csrf;
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: '/',
      sameSite: 'Lax',
      secure: isHttpsRequest(c),
    });
    if (isHttpsRequest(c)) {
      deleteCookie(c, EMBEDDED_SESSION_COOKIE_NAME, {
        path: '/',
        secure: true,
        sameSite: 'None',
        partitioned: true,
      });
    }
    return c.json({ ok: true });
  });
}
