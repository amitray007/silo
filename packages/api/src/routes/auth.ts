import type { Hono } from 'hono';
import { bearerToken, readTokenEnv, timingSafeEqual } from '../token-auth.js';

/**
 * `GET /api/auth/check` — an ungated auth-state PROBE, not a gate. The web
 * app calls this on load to learn (a) whether `SILO_API_TOKEN` is even
 * configured on this deployment and (b) whether the token it's currently
 * holding (if any) is valid — so it knows whether to show the app or a login
 * screen (plan 030, Unit 1; `docs/superpowers/specs/2026-07-10-web-auth-
 * design.md`).
 *
 * Registered on the ROOT `app` (like `/health`), NOT the `/api` sub-app that
 * carries `generalTokenAuth` (`app.ts`) — this route must be reachable with
 * NO bearer token even when `SILO_API_TOKEN` is set, otherwise the web app
 * could never learn it needs to show a login screen in the first place. It
 * ALWAYS returns 200: this endpoint reports auth state, it never enforces
 * it, and it never leaks whether a *specific* wrong token was close (the
 * timing-safe compare + a boolean-only response keep it from becoming an
 * oracle). No DB access.
 */
export function registerAuthRoutes(app: Hono): void {
  app.get('/api/auth/check', (c) => {
    const expected = readTokenEnv('SILO_API_TOKEN');
    if (!expected) return c.json({ authRequired: false });

    const presented = bearerToken(c);
    const authenticated = presented !== undefined && timingSafeEqual(presented, expected);
    return c.json({ authRequired: true, authenticated });
  });
}
