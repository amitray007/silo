import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Same placeholder-DATABASE_URL pattern as `app.test.ts` — these are pure
// app-level/CORS-header tests, no DB connection is ever opened.
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

beforeEach(() => {
  delete process.env.SILO_ALLOWED_ORIGINS;
});

afterEach(() => {
  delete process.env.SILO_ALLOWED_ORIGINS;
});

/**
 * CORS allowlist tests for `/api/*` (plan 021, `cors.ts`). Driven via
 * `createApp()` + `app.request(...)` per `docs/rules/api-hono.md` — no real
 * socket, so a request's `Origin` header is set explicitly per case (a real
 * browser sets it automatically; these tests simulate that).
 */
describe('CORS on /api/*', () => {
  it('an allowlisted origin (default localhost) gets Access-Control-Allow-Origin echoed back', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('a non-allowlisted origin gets NO CORS headers', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never emits a wildcard Access-Control-Allow-Origin, even for an allowed origin', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('preflight OPTIONS from an allowed origin succeeds with the expected allow-headers/methods', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/links', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowHeaders.toLowerCase()).toContain('authorization');
    expect(allowHeaders.toLowerCase()).toContain('content-type');
  });

  it('preflight OPTIONS from a disallowed origin gets no CORS allow headers', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/links', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('SILO_ALLOWED_ORIGINS set: only the configured origins are allowed, not the defaults', async () => {
    process.env.SILO_ALLOWED_ORIGINS = 'https://silo.example.com,chrome-extension://abc123';
    const { createApp } = await import('./app.js');
    const app = createApp();

    const configured = await app.request('/api/tags', {
      headers: { Origin: 'https://silo.example.com' },
    });
    expect(configured.headers.get('access-control-allow-origin')).toBe('https://silo.example.com');

    const extension = await app.request('/api/tags', {
      headers: { Origin: 'chrome-extension://abc123' },
    });
    expect(extension.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc123');

    // The default dev origin is NOT implicitly kept once the var is set.
    const defaultOrigin = await app.request('/api/tags', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(defaultOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a request with no Origin header (same-origin/non-browser) is unaffected', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const res = await app.request('/api/tags');
    // No CORS headers expected either way — this simply isn't a CORS
    // request; the route itself still runs normally.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('readAllowedOrigins', () => {
  it('defaults to the localhost dev origins when unset', async () => {
    const { readAllowedOrigins } = await import('./cors.js');
    expect(readAllowedOrigins()).toEqual(['http://localhost:5173', 'http://localhost:8787']);
  });

  it('parses a comma-separated SILO_ALLOWED_ORIGINS, trimming whitespace', async () => {
    process.env.SILO_ALLOWED_ORIGINS = ' https://a.example.com , https://b.example.com ';
    const { readAllowedOrigins } = await import('./cors.js');
    expect(readAllowedOrigins()).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('falls back to defaults when SILO_ALLOWED_ORIGINS is set but empty/whitespace-only', async () => {
    process.env.SILO_ALLOWED_ORIGINS = '   ';
    const { readAllowedOrigins } = await import('./cors.js');
    expect(readAllowedOrigins()).toEqual(['http://localhost:5173', 'http://localhost:8787']);
  });
});
