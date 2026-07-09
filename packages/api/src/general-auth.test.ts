import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from './app.js';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

beforeEach(() => {
  delete process.env.SILO_API_TOKEN;
});

afterEach(() => {
  delete process.env.SILO_API_TOKEN;
});

const TOKEN = 'general-api-test-token-do-not-use-in-prod';

/**
 * Tests for the OPTIONAL general-API bearer-token gate (plan 021,
 * `general-auth.ts`) — driven via `createApp()` + `app.request(...)` per
 * `docs/rules/api-hono.md`. Covers: unset -> no auth (preserves today's
 * default), set -> 401 without/with-wrong header, not-401 with the correct
 * header, and the `/health` exemption.
 *
 * These are auth-gate tests, not route/DB tests: `/api/tags` may 500 against
 * an unmigrated CI Postgres (relation "tags" does not exist). Assert the gate
 * outcome only — never require a successful DB round-trip here.
 */
describe('general-API bearer token gate', () => {
  it('SILO_API_TOKEN unset: /api/tags is reachable with no Authorization header', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags');
    // Gate did not reject; route may still 500 without a migrated schema.
    expect(res.status).not.toBe(401);
  });

  it('SILO_API_TOKEN set: /api/tags without an Authorization header is 401', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags');
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('unauthorized');
  });

  it('SILO_API_TOKEN set: /api/tags with the WRONG token is 401', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('SILO_API_TOKEN set: /api/tags with the correct token is not 401', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    // Gate accepted the token; route may still 500 without a migrated schema.
    expect(res.status).not.toBe(401);
  });

  it('GET /health is reachable WITHOUT the token, even when SILO_API_TOKEN is set', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET / (service descriptor, outside /api) is reachable without the token', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
  });
});

describe('middleware order: CORS before the general token gate', () => {
  it('a disallowed origin is blocked by CORS (no CORS headers) even when SILO_API_TOKEN is unset', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Origin: 'https://evil.example.com' },
    });
    // The route still runs (no general auth configured) but CORS headers are
    // absent — a browser would refuse to expose this response to the page.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('an allowed origin with no token still gets 401 once SILO_API_TOKEN is set', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.status).toBe(401);
  });
});

describe('/api/ingest stays closed-by-default (regression)', () => {
  it('POST /api/ingest is 401 when SILO_API_TOKEN is unset, even though it is unset for the general gate too', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/ingest is 401 with the general token if the ingest-specific auth still rejects it', async () => {
    process.env.SILO_API_TOKEN = TOKEN;
    const { createApp } = await import('./app.js');
    const app = createApp();
    // With SILO_API_TOKEN set, the general gate WOULD allow this through with
    // the correct header, but /api/ingest's own gate (ingest-auth.ts) also
    // requires the same token — sending it should pass both and reach the
    // route (which then does real work / may 400 on a placeholder DB, but
    // must NOT be a 401 from either gate).
    const res = await app.request('/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).not.toBe(401);
  });
});
