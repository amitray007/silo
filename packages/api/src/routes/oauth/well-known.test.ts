import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Tests for `GET /.well-known/oauth-authorization-server` (RFC 8414) — driven
 * via `createApp()` + `app.request(...)` per `docs/rules/api-hono.md`. This
 * route itself touches no core/db call, but `app.ts` now imports the other
 * `/oauth/*` route modules at module load, which transitively import
 * `@silo/core` -> `@silo/db`'s client (throws if `DATABASE_URL` is unset at
 * import time) — same placeholder-env discipline as `login.test.ts`.
 */
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

beforeEach(() => {
  delete process.env.SILO_PUBLIC_API_URL;
});

afterEach(() => {
  delete process.env.SILO_PUBLIC_API_URL;
});

type WellKnownResponse = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
};

describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns the RFC 8414 metadata shape, derived from the request origin', async () => {
    const { createApp } = await import('../../app.js');
    const app = createApp();

    const res = await app.request(
      'https://silo.example.com/.well-known/oauth-authorization-server',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WellKnownResponse;

    expect(body.issuer).toBe('https://silo.example.com');
    expect(body.authorization_endpoint).toBe('https://silo.example.com/oauth/authorize');
    expect(body.token_endpoint).toBe('https://silo.example.com/oauth/token');
    expect(body.registration_endpoint).toBe('https://silo.example.com/oauth/register');
    expect(body.response_types_supported).toEqual(['code']);
    expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(body.scopes_supported).toEqual(['silo']);
  });

  it('derives the origin from x-forwarded-host/x-forwarded-proto over the raw request URL', async () => {
    const { createApp } = await import('../../app.js');
    const app = createApp();

    const res = await app.request('http://localhost/.well-known/oauth-authorization-server', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'silo.example.com' },
    });
    const body = (await res.json()) as WellKnownResponse;
    expect(body.issuer).toBe('https://silo.example.com');
  });

  it('carries the wildcard CORS headers', async () => {
    const { createApp } = await import('../../app.js');
    const app = createApp();

    const res = await app.request(
      'https://silo.example.com/.well-known/oauth-authorization-server',
      {
        headers: { Origin: 'https://chatgpt.com' },
      },
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
