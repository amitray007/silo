import type { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let app: Hono;
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
  const { createApp } = await import('../app.js');
  app = createApp();
});
beforeEach(() => {
  vi.stubEnv('SILO_API_TOKEN', '');
  vi.stubEnv('SILO_APP_PASSWORD', '');
  vi.stubEnv('SILO_SESSION_SECRET', '');
});
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/links/saved', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/links/saved guards (no database)', () => {
  it.each([
    {},
    { urls: [] },
    { urls: 'wrong' },
    { urls: [1] },
    { urls: Array.from({ length: 51 }, () => 'https://example.com') },
  ])('rejects invalid body %j with the validation envelope', async (body) => {
    const response = await request(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'validation_error',
      details: expect.any(Array),
    });
  });

  it('requires authentication when configured', async () => {
    vi.stubEnv('SILO_API_TOKEN', 'saved-route-test-token');
    const response = await request({ urls: ['https://example.com'] });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('accepts bearer auth without a CSRF header and reaches body validation', async () => {
    vi.stubEnv('SILO_API_TOKEN', 'saved-route-test-token');
    const response = await request(
      { urls: [] },
      { Authorization: 'Bearer saved-route-test-token' },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
  });

  it('requires the CSRF header for a cookie session', async () => {
    vi.stubEnv('SILO_APP_PASSWORD', 'saved-route-test-password');
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Silo-CSRF': '1' },
      body: JSON.stringify({ password: 'saved-route-test-password' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const rejected = await request({ urls: [] }, { Cookie: cookie });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: 'csrf_required' });
    const accepted = await request({ urls: [] }, { Cookie: cookie, 'X-Silo-CSRF': '1' });
    expect(accepted.status).toBe(400);
    expect(await accepted.json()).toMatchObject({ error: 'validation_error' });
  });
});
