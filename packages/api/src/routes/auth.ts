import {
  readAppPassword,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  sessionSecret,
} from '@silo/core';
import type { Hono } from 'hono';
import { getSignedCookie } from 'hono/cookie';
import { bearerToken, readTokenEnv, timingSafeEqual } from '../token-auth.js';

/**
 * `GET /api/auth/check` — an ungated auth-state PROBE, not a gate. The web
 * app calls this on load to learn (a) whether EITHER `SILO_API_TOKEN` or
 * `SILO_APP_PASSWORD` is configured on this deployment and (b) whether the
 * current request is already authenticated (a valid bearer OR a valid
 * `silo_session` cookie) — so it knows whether to show the app or a login
 * screen (plan 030, Unit 1; extended by the web-auth cookie upgrade, Unit 3,
 * `docs/superpowers/specs/2026-07-11-web-auth-cookie-upgrade.md`). This is
 * what lets the web guard learn "logged in via cookie" without ever holding
 * a token client-side.
 *
 * Registered on the ROOT `app` (like `/health`), NOT the `/api` sub-app that
 * carries `generalTokenAuth` (`app.ts`) — this route must be reachable with
 * NO credential even when auth is configured, otherwise the web app could
 * never learn it needs to show a login screen in the first place. It
 * ALWAYS returns 200: this endpoint reports auth state, it never enforces
 * it, and it never leaks whether a *specific* wrong token/cookie was close
 * (the timing-safe compare + a boolean-only response keep it from becoming
 * an oracle). No DB access (bearer DB-tokens are intentionally NOT checked
 * here, same as before this upgrade — only the env token and the session
 * cookie, both DB-free checks).
 */
export function registerAuthRoutes(app: Hono): void {
  app.get('/api/auth/check', async (c) => {
    const expectedToken = readTokenEnv('SILO_API_TOKEN');
    const passwordConfigured = readAppPassword() !== undefined;
    const authRequired = expectedToken !== undefined || passwordConfigured;
    if (!authRequired) return c.json({ authRequired: false });

    const presented = bearerToken(c);
    const validBearer =
      expectedToken !== undefined &&
      presented !== undefined &&
      timingSafeEqual(presented, expectedToken);

    let validCookie = false;
    const secret = sessionSecret();
    if (!validBearer && secret) {
      const value = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
      validCookie = value === SESSION_COOKIE_VALUE;
    }

    return c.json({ authRequired: true, authenticated: validBearer || validCookie });
  });
}
