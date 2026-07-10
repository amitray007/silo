import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
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

const TOKEN = 'auth-check-test-token-do-not-use-in-prod';
const PASSWORD = 'auth-check-test-password-do-not-use-in-prod';

type AuthCheckBody = { authRequired: boolean; authenticated?: boolean };

/**
 * Tests for `GET /api/auth/check` (plan 030, Unit 1; extended by the
 * web-auth cookie upgrade, Unit 3) — the ungated auth-state probe the web
 * app calls to learn whether EITHER `SILO_API_TOKEN` or `SILO_APP_PASSWORD`
 * is configured, and whether the current request is already authenticated
 * (bearer OR session cookie). Driven via `createApp()` + `app.request(...)`
 * per `docs/rules/api-hono.md`, mirroring `general-auth.test.ts`'s env
 * set/restore pattern. No DB harness needed — this route never touches the
 * database.
 */
describe('GET /api/auth/check', () => {
  it('SILO_API_TOKEN unset: returns 200 { authRequired: false }', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/auth/check');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authRequired: false });
  });

  it('SILO_API_TOKEN set, no Authorization header: 200 { authRequired: true, authenticated: false } (reachable without a token — NOT gated)', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/auth/check');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthCheckBody;
    expect(body).toEqual({ authRequired: true, authenticated: false });
  });

  it('SILO_API_TOKEN set, correct bearer: 200 { authRequired: true, authenticated: true }', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/auth/check', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthCheckBody;
    expect(body).toEqual({ authRequired: true, authenticated: true });
  });

  it('SILO_API_TOKEN set, wrong bearer: 200 { authRequired: true, authenticated: false }', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/auth/check', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthCheckBody;
    expect(body).toEqual({ authRequired: true, authenticated: false });
  });

  it('SILO_APP_PASSWORD set, no credential: 200 { authRequired: true, authenticated: false } (reachable without one — NOT gated)', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/auth/check');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthCheckBody;
    expect(body).toEqual({ authRequired: true, authenticated: false });
  });

  it('SILO_APP_PASSWORD set, valid session cookie minted by POST /api/login: 200 { authRequired: true, authenticated: true }', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();

    const loginRes = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0];

    const res = await app.request('/api/auth/check', {
      headers: { Cookie: cookieHeader ?? '' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthCheckBody;
    expect(body).toEqual({ authRequired: true, authenticated: true });
  });

  it('SILO_APP_PASSWORD set, forged/tampered session cookie: 200 { authRequired: true, authenticated: false }', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/auth/check', {
      headers: { Cookie: 'silo_session=not-a-real-signed-value' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthCheckBody;
    expect(body).toEqual({ authRequired: true, authenticated: false });
  });
});
