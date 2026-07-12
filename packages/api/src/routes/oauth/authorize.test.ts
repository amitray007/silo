import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET`/`POST /oauth/authorize` — driven via
 * `createApp()` + `app.request(...)` against a real disposable Postgres
 * (mirrors `access-tokens.test.ts`'s harness pattern). Covers param
 * validation + the open-redirector guard (unknown client / bad redirect_uri
 * must render an error page, NEVER redirect), the resource (RFC 8707) check,
 * the login-prompt vs consent-screen branch on session cookie presence, and
 * the approve/deny POST outcomes.
 *
 * `SILO_PUBLIC_MCP_URL`/`SILO_APP_PASSWORD` are set/restored around every
 * test (both are read fresh per-request by the route, same discipline as
 * `general-auth.test.ts`/`access-tokens.test.ts`'s `SILO_API_TOKEN`
 * set/restore).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const MCP_URL = 'https://mcp.example.com/mcp';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const PASSWORD = 'correct-horse-battery-staple';

beforeEach(() => {
  process.env.SILO_PUBLIC_MCP_URL = MCP_URL;
  delete process.env.SILO_APP_PASSWORD;
});

afterEach(() => {
  delete process.env.SILO_PUBLIC_MCP_URL;
  delete process.env.SILO_APP_PASSWORD;
});

async function registerClient(app: Hono, redirectUri = REDIRECT_URI): Promise<string> {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
  });
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

function authorizeUrl(params: Record<string, string>): string {
  const search = new URLSearchParams({
    response_type: 'code',
    code_challenge: 'abc123-challenge',
    code_challenge_method: 'S256',
    resource: MCP_URL,
    ...params,
  });
  return `/oauth/authorize?${search.toString()}`;
}

/** Logs in via `POST /api/login` and returns the `Set-Cookie` value to
 * replay on subsequent requests — the same session cookie
 * `/oauth/authorize` itself checks (`silo_session`, `hasValidSessionCookie`
 * mirrors `general-auth.ts`'s check exactly). */
async function loginCookie(app: Hono): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login did not set a cookie');
  return setCookie.split(';')[0] ?? '';
}

describeIfPg('GET/POST /oauth/authorize (MCP OAuth slice U2)', () => {
  const harness = setupPgHarness('silo_api_oauth_authorize_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../../app.js');
    return { core, app: createApp() };
  });

  describe('param validation (open-redirector guard: error page, never a redirect)', () => {
    it('missing client_id/redirect_uri/code_challenge: 400 HTML error, no redirect', async () => {
      const { app } = harness.mod();
      const res = await app.request('/oauth/authorize?response_type=code');
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    it('unsupported response_type: 400 HTML error', async () => {
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const res = await app.request(
        authorizeUrl({ response_type: 'token', client_id: clientId, redirect_uri: REDIRECT_URI }),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    });

    it('unsupported code_challenge_method: 400 HTML error', async () => {
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const res = await app.request(
        authorizeUrl({
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_challenge_method: 'plain',
        }),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    });

    it('missing/mismatched resource param (RFC 8707): 400 HTML error, no redirect', async () => {
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const res = await app.request(
        authorizeUrl({
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          resource: 'https://mcp.wrong-domain.com/mcp',
        }),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    });

    it('unknown client_id: 400 HTML error, NEVER a redirect (open-redirector guard)', async () => {
      const { app } = harness.mod();
      const res = await app.request(
        authorizeUrl({
          client_id: 'cli_does_not_exist',
          redirect_uri: 'https://evil.example.com/steal',
        }),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      const html = await res.text();
      expect(html).not.toContain('evil.example.com');
    });

    it('redirect_uri not on the client allowlist: 400 HTML error, NEVER a redirect', async () => {
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const res = await app.request(
        authorizeUrl({ client_id: clientId, redirect_uri: 'https://evil.example.com/steal' }),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    });
  });

  describe('session branch', () => {
    it('no session cookie: renders the login prompt (not the consent screen)', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const res = await app.request(
        authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI }),
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Sign in');
      expect(html).not.toContain('Approve');
    });

    it('valid session cookie: renders the consent screen with the client name', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const cookie = await loginCookie(app);
      const clientId = await registerClient(app);
      const res = await app.request(
        authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI }),
        {
          headers: { Cookie: cookie },
        },
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Test Client');
      expect(html).toContain('Approve');
    });
  });

  describe('approve/deny decision', () => {
    it('approve: 302 to redirect_uri with a code + state', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const cookie = await loginCookie(app);
      const clientId = await registerClient(app);
      const query = authorizeUrl({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        state: 'xyz',
      }).replace('/oauth/authorize?', '');

      const res = await app.request(`/oauth/authorize?${query}`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'decision=approve',
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.origin + location.pathname).toBe(REDIRECT_URI);
      expect(location.searchParams.get('code')).toBeTruthy();
      expect(location.searchParams.get('state')).toBe('xyz');
    });

    it('deny: 302 to redirect_uri with error=access_denied', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const cookie = await loginCookie(app);
      const clientId = await registerClient(app);
      const query = authorizeUrl({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        state: 'xyz',
      }).replace('/oauth/authorize?', '');

      const res = await app.request(`/oauth/authorize?${query}`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'decision=deny',
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.searchParams.get('error')).toBe('access_denied');
      expect(location.searchParams.get('state')).toBe('xyz');
    });

    it('POST without a session cookie: renders the login prompt, does not approve', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const query = authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI }).replace(
        '/oauth/authorize?',
        '',
      );

      const res = await app.request(`/oauth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'decision=approve',
        redirect: 'manual',
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Sign in');
    });
  });

  describe('POST /oauth/authorize/login (inline consent-screen login)', () => {
    it('wrong password: 401, re-renders the login page with an error', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const query = authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI }).replace(
        '/oauth/authorize?',
        '',
      );

      const res = await app.request(`/oauth/authorize/login?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong-password',
      });
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain('Sign in');
      expect(html).toContain('Incorrect password');
    });

    it('correct password: sets the session cookie (30-day Max-Age) and re-renders the consent screen', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const query = authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI }).replace(
        '/oauth/authorize?',
        '',
      );

      const res = await app.request(`/oauth/authorize/login?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `password=${PASSWORD}`,
      });
      expect(res.status).toBe(200);

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('silo_session=');
      // Guards the maxAge fix: without it this cookie would be session-only
      // (no Max-Age at all), a shorter-lived session than `/api/login` mints.
      expect(setCookie).toContain('Max-Age=2592000');

      const html = await res.text();
      expect(html).toContain('Test Client');
      expect(html).toContain('Approve');
      expect(html).toContain('Deny');
    });

    it('SILO_APP_PASSWORD unset: 400, login not configured', async () => {
      const { app } = harness.mod();
      const clientId = await registerClient(app);
      const query = authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI }).replace(
        '/oauth/authorize?',
        '',
      );

      const res = await app.request(`/oauth/authorize/login?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'password=anything',
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain('Login is not configured');
    });
  });

  it('carries wildcard CORS headers', async () => {
    const { app } = harness.mod();
    const res = await app.request(
      authorizeUrl({ client_id: 'cli_x', redirect_uri: REDIRECT_URI }),
      {
        headers: { Origin: 'https://chatgpt.com' },
      },
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
