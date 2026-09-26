import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

beforeEach(() => {
  delete process.env.SILO_APP_PASSWORD;
  delete process.env.SILO_SESSION_SECRET;
});

afterEach(() => {
  delete process.env.SILO_APP_PASSWORD;
  delete process.env.SILO_SESSION_SECRET;
});

const PASSWORD = 'correct-horse-battery-staple';
const CSRF_HEADERS = { 'X-Silo-CSRF': '1', 'content-type': 'application/json' };

/**
 * Tests for `POST /api/login`/`POST /api/logout` (web-auth cookie upgrade,
 * Unit 2) — driven via `createApp()` + `app.request(...)` per
 * `docs/rules/api-hono.md`, mirroring `auth.test.ts`'s env set/restore
 * pattern. No DB harness needed: neither route touches the database.
 */
describe('POST /api/login', () => {
  it('no SILO_APP_PASSWORD configured: 400 (login not applicable)', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: 'anything' }),
    });
    expect(res.status).toBe(400);
  });

  it('correct password: 200 + a Set-Cookie carrying silo_session, HttpOnly, SameSite=Lax', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('silo_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    // The ~30-day session lifetime is a security-relevant attribute (how long a
    // leaked cookie stays valid — ce-security testing-gap), so assert it on the
    // mint path rather than trusting the inlined constant: 30 days = 2592000s.
    expect(setCookie).toContain('Max-Age=2592000');
  });

  it('correct password over a plain-http request: the cookie is NOT marked Secure (dev-http can still send it back)', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('http://localhost/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: PASSWORD }),
    });
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toContain('Secure');
  });

  it('correct password over an https request: the cookie IS marked Secure', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('https://silo.example.com/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: PASSWORD }),
    });
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('Secure');
  });

  it('correct password over plain http behind a TLS-terminating proxy (x-forwarded-proto): the cookie IS marked Secure', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('http://localhost/api/login', {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('Secure');
  });

  it('wrong password: 401, no cookie set', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('POST /api/logout', () => {
  it('always returns 200, and clears silo_session (Max-Age=0 / an expired Expires)', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/logout', {
      method: 'POST',
      headers: { 'X-Silo-CSRF': '1' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('silo_session=');
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('is a no-op 200 even when no password is configured', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/logout', {
      method: 'POST',
      headers: { 'X-Silo-CSRF': '1' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects logout without the custom CSRF header', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/logout', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('embedded login and CSRF', () => {
  it('rejects login without the custom CSRF header before checking the password', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('https://silo.example.com/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, embedded: true }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sets a partitioned HTTPS-only embedded session cookie', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('https://silo.example.com/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: PASSWORD, embedded: true }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(res.status).toBe(200);
    expect(setCookie).toContain('__Host-silo_embed_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Partitioned');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=2592000');
  });

  it('accepts the TLS proxy signal for embedded login', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('http://localhost/api/login', {
      method: 'POST',
      headers: { ...CSRF_HEADERS, 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ password: PASSWORD, embedded: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Partitioned');
  });

  it('rejects embedded login over insecure HTTP with an actionable error', async () => {
    process.env.SILO_APP_PASSWORD = PASSWORD;
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('http://localhost/api/login', {
      method: 'POST',
      headers: CSRF_HEADERS,
      body: JSON.stringify({ password: PASSWORD, embedded: true }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'embedded_login_requires_https',
      message: 'Embedded login requires HTTPS. Open Silo directly or use HTTPS through the proxy.',
    });
  });

  it('expires both regular and embedded sessions on HTTPS logout', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('https://silo.example.com/api/logout', {
      method: 'POST',
      headers: { 'X-Silo-CSRF': '1' },
    });
    const setCookies = res.headers.getSetCookie();
    const regular = setCookies.find((cookie) => cookie.startsWith('silo_session='));
    const embedded = setCookies.find((cookie) => cookie.startsWith('__Host-silo_embed_session='));
    expect(regular).toBeTruthy();
    expect(regular).toContain('Path=/');
    expect(regular).toContain('SameSite=Lax');
    expect(regular).toContain('Secure');
    expect(regular).toContain('Max-Age=0');
    expect(embedded).toBeTruthy();
    expect(embedded).toContain('Path=/');
    expect(embedded).toContain('SameSite=None');
    expect(embedded).toContain('Secure');
    expect(embedded).toContain('Partitioned');
    expect(embedded).toContain('Max-Age=0');
  });
});
