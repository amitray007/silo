import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from './app.js';
import { setupPgHarness } from './test-support/pg-harness.js';

/**
 * Tests for the general-API auth gate (`general-auth.ts`, plan 021 + the
 * access-tokens slice's DB-token fallback, U2 + the web-auth cookie
 * upgrade's session-cookie branch, U3) — driven via `createApp()` +
 * `app.request(...)` per `docs/rules/api-hono.md`.
 *
 * REAL DISPOSABLE DB (not a placeholder `DATABASE_URL`): this file used to
 * point `DATABASE_URL` at a syntactically-valid-but-unmigrated placeholder,
 * since the env-token-only gate never touched the DB. Since U2 added a
 * DB-token fallback (`verifyAccessToken`, a real hash-lookup query), some
 * tests below now need a genuinely migrated Postgres — so the WHOLE file
 * uses `setupPgHarness` (the same disposable-DB-per-file pattern as
 * `routes/ingest.test.ts`/`routes/import.test.ts`), rather than splitting
 * placeholder-DB and real-DB describe blocks in one file. That split was
 * tried first and LEAKED test rows into `silo_dev`: `@silo/db`'s `pool`/`db`
 * singleton reads `DATABASE_URL` once at first import and never re-reads it,
 * so whichever describe block's dynamic `import('@silo/core')` runs FIRST
 * within this file wins the singleton's connection — and vitest runs
 * `describe` blocks (and their tests) in top-to-bottom registration order,
 * not hook-registration order, so a later block's `beforeAll` reassigning
 * `process.env.DATABASE_URL` is too late once an earlier block already
 * imported `@silo/core` against whatever `DATABASE_URL` the process started
 * with (this repo's test scripts run with `DATABASE_URL` pointed at
 * `silo_dev`). Using ONE `setupPgHarness` call for the entire file sidesteps
 * this: its `beforeAll` is the first thing to run, so `@silo/core` is never
 * imported (by any describe block in this file) before the disposable DB's
 * URL is in place. A migrated real DB doesn't break any of the pre-existing
 * gate-only assertions — `/api/tags` now cleanly returns 200 instead of a
 * possible 500-on-unmigrated-schema, which none of those tests asserted on
 * anyway (they only ever asserted the gate outcome, `401` vs `not 401`).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const TOKEN = 'general-api-test-token-do-not-use-in-prod';

describeIfPg('general-API bearer token gate', () => {
  const harness = setupPgHarness('silo_api_general_auth_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('./app.js');
    return { core, app: createApp() };
  });

  beforeEach(() => {
    delete process.env.SILO_API_TOKEN;
    delete process.env.SILO_APP_PASSWORD;
    delete process.env.SILO_SESSION_SECRET;
  });

  afterEach(() => {
    delete process.env.SILO_API_TOKEN;
    delete process.env.SILO_APP_PASSWORD;
    delete process.env.SILO_SESSION_SECRET;
  });

  describe('env token (unchanged behavior)', () => {
    it('SILO_API_TOKEN unset: /api/tags is reachable with no Authorization header', async () => {
      const { app } = harness.mod();
      const res = await app.request('/api/tags');
      expect(res.status).not.toBe(401);
    });

    it('SILO_API_TOKEN set: /api/tags without an Authorization header is 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/tags');
      expect(res.status).toBe(401);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('unauthorized');
    });

    it('SILO_API_TOKEN set: /api/tags with the WRONG token is 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/tags', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
    });

    it('SILO_API_TOKEN set: /api/tags with the correct token is not 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/tags', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).not.toBe(401);
    });

    it('GET /health is reachable WITHOUT the token, even when SILO_API_TOKEN is set', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('GET / (service descriptor, outside /api) is reachable without the token', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/');
      expect(res.status).toBe(200);
    });
  });

  describe('middleware order: CORS before the general token gate', () => {
    it('a disallowed origin is blocked by CORS (no CORS headers) even when SILO_API_TOKEN is unset', async () => {
      const { app } = harness.mod();
      const res = await app.request('/api/tags', {
        headers: { Origin: 'https://evil.example.com' },
      });
      // The route still runs (no general auth configured) but CORS headers are
      // absent — a browser would refuse to expose this response to the page.
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('an allowed origin with no token still gets 401 once SILO_API_TOKEN is set', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/tags', {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(res.status).toBe(401);
    });
  });

  describe('/api/ingest stays closed-by-default (regression)', () => {
    it('POST /api/ingest is 401 when SILO_API_TOKEN is unset, even though it is unset for the general gate too', async () => {
      const { app } = harness.mod();
      const res = await app.request('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      expect(res.status).toBe(401);
    });

    it('POST /api/ingest is 401 with the general token if the ingest-specific auth still rejects it', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      // With SILO_API_TOKEN set, the general gate WOULD allow this through with
      // the correct header, but /api/ingest's own gate (ingest-auth.ts) also
      // requires the same token — sending it should pass both and reach the
      // route (which then does real work, but must NOT be a 401 from either
      // gate).
      const res = await app.request('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      expect(res.status).not.toBe(401);
    });
  });

  describe('DB-backed access tokens (access-tokens slice, U2)', () => {
    it('a valid DB access token authorizes /api/tags (gate is ON via SILO_API_TOKEN, presented bearer is a DB token, not the env one)', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { core, app } = harness.mod();
      const created = await core.generateAccessToken('general-auth db-token test');
      const res = await app.request('/api/tags', {
        headers: { Authorization: `Bearer ${created.token}` },
      });
      expect(res.status).not.toBe(401);
    });

    it('a REVOKED DB access token is 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { core, app } = harness.mod();
      const created = await core.generateAccessToken('general-auth revoked-token test');
      const revoked = await core.revokeAccessToken(created.id);
      expect(revoked).toBe(true);

      const res = await app.request('/api/tags', {
        headers: { Authorization: `Bearer ${created.token}` },
      });
      expect(res.status).toBe(401);
    });

    it('the env SILO_API_TOKEN still works when DB tokens also exist', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { core, app } = harness.mod();
      await core.generateAccessToken('general-auth unrelated-token test');

      const res = await app.request('/api/tags', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).not.toBe(401);
    });

    it('SILO_API_TOKEN unset: the gate stays fully open (no-op) even though DB tokens exist', async () => {
      const { core, app } = harness.mod();
      await core.generateAccessToken('general-auth dormant-token test');

      const res = await app.request('/api/tags');
      expect(res.status).not.toBe(401);
    });
  });

  /**
   * Session-cookie branch (web-auth cookie upgrade, Unit 3): gated purely on
   * `SILO_APP_PASSWORD` (no `SILO_API_TOKEN` involved), proving the cookie
   * credential is a genuine third auth path, not piggybacking on the bearer
   * branches. Each test mints its cookie for real via `POST /api/login`
   * (rather than hand-crafting a signed cookie value) so these tests also
   * double as an end-to-end proof that Unit 2's login route and this gate
   * agree on the same secret/name/value.
   */
  describe('session cookie (web-auth cookie upgrade, U3)', () => {
    const PASSWORD = 'general-auth-cookie-test-password';

    it('SILO_APP_PASSWORD set, no credential at all: /api/tags is 401', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const res = await app.request('/api/tags');
      expect(res.status).toBe(401);
    });

    it('a silo_session cookie minted by POST /api/login authorizes /api/tags', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();

      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      const setCookie = loginRes.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      const cookieHeader = setCookie?.split(';')[0];

      const res = await app.request('/api/tags', {
        headers: { Cookie: cookieHeader ?? '' },
      });
      expect(res.status).not.toBe(401);
    });

    it('a forged/tampered silo_session cookie is 401', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();

      const res = await app.request('/api/tags', {
        headers: { Cookie: 'silo_session=not-a-real-signed-value' },
      });
      expect(res.status).toBe(401);
    });

    it('a valid cookie minted under one password does not authorize once the password (and thus the derived secret) changes', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();

      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      });
      const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0];

      process.env.SILO_APP_PASSWORD = 'a-completely-different-password';
      const res = await app.request('/api/tags', {
        headers: { Cookie: cookieHeader ?? '' },
      });
      expect(res.status).toBe(401);
    });

    it('Bearer env-token still works when SILO_APP_PASSWORD is also set (extension path intact)', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();

      const res = await app.request('/api/tags', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).not.toBe(401);
    });

    it('only SILO_API_TOKEN set (no password): behavior is unchanged — no credential is 401, and a cookie header is simply ignored', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();

      const noCredRes = await app.request('/api/tags');
      expect(noCredRes.status).toBe(401);

      const cookieOnlyRes = await app.request('/api/tags', {
        headers: { Cookie: 'silo_session=whatever' },
      });
      expect(cookieOnlyRes.status).toBe(401);

      const bearerRes = await app.request('/api/tags', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(bearerRes.status).not.toBe(401);
    });

    it('SILO_SESSION_SECRET (set independently of the password) signs the cookie: it verifies at the gate, and rotating ONLY the secret invalidates it', async () => {
      // ce-security testing-gap: the independent-secret precedence
      // (`sessionSecret()` prefers SILO_SESSION_SECRET over the password) was
      // only unit-tested on the helper; exercise it end-to-end through
      // login -> gate, and prove rotating the signing secret alone (password
      // unchanged) is a valid force-logout lever.
      process.env.SILO_APP_PASSWORD = PASSWORD;
      process.env.SILO_SESSION_SECRET = 'an-independent-signing-secret-not-the-password';
      const { app } = harness.mod();

      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0];

      const okRes = await app.request('/api/tags', { headers: { Cookie: cookieHeader ?? '' } });
      expect(okRes.status).not.toBe(401);

      // Rotate ONLY the signing secret (password stays the same) — the
      // previously-minted cookie must no longer verify.
      process.env.SILO_SESSION_SECRET = 'a-rotated-independent-signing-secret';
      const afterRotate = await app.request('/api/tags', {
        headers: { Cookie: cookieHeader ?? '' },
      });
      expect(afterRotate.status).toBe(401);
    });

    it('CSRF: a cross-site form-encoded POST to a write route is rejected (400, not a mutation) even if it carried a valid session cookie', async () => {
      // ce-security testing-gap: the CSRF defense rests on write routes
      // requiring a JSON body (c.req.json() + Zod). SameSite=Lax already blocks
      // cross-site subresource POSTs from carrying the cookie; the only
      // credentialed cross-site request Lax permits is a top-level-navigation
      // <form> POST, which can only send form-encoded/multipart/text bodies —
      // never application/json. Lock in that such a body fails to parse into a
      // valid write BEFORE any mutation, so a forged top-level POST can't
      // mutate. We attach a genuinely-valid session cookie to prove the
      // rejection is the body contract, not the auth gate.
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();

      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      });
      const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0];

      // A classic HTML form submit: form-encoded body, NOT JSON.
      const res = await app.request('/api/links', {
        method: 'POST',
        headers: {
          Cookie: cookieHeader ?? '',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'url=https://evil.example.com/forged',
      });
      // The gate passes (valid cookie), but the body isn't JSON -> the capture
      // route's c.req.json()/Zod validation rejects it: a 4xx, never a 2xx
      // create. The forged navigation cannot mutate the store.
      expect(res.status).not.toBe(401);
      expect(res.ok).toBe(false);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
