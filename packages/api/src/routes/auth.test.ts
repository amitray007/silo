import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

beforeEach(() => {
  delete process.env.SILO_API_TOKEN;
});

afterEach(() => {
  delete process.env.SILO_API_TOKEN;
});

const TOKEN = 'auth-check-test-token-do-not-use-in-prod';

type AuthCheckBody = { authRequired: boolean; authenticated?: boolean };

/**
 * Tests for `GET /api/auth/check` (plan 030, Unit 1) — the ungated
 * auth-state probe the web app calls to learn whether `SILO_API_TOKEN` is
 * configured and whether a presented bearer is valid. Driven via
 * `createApp()` + `app.request(...)` per `docs/rules/api-hono.md`, mirroring
 * `general-auth.test.ts`'s env set/restore pattern. No DB harness needed —
 * this route never touches the database.
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
});
