import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `POST /oauth/register` (DCR, RFC 7591) —
 * driven via `createApp()` + `app.request(...)` against a real disposable
 * Postgres, mirroring `access-tokens.test.ts`'s harness pattern (ONE
 * `setupPgHarness` for the file — the `@silo/db` pool singleton rationale).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

type RegisterResponse = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
};

type OAuthErrorBody = { error: string; error_description: string };

async function register(body: unknown): Promise<Response> {
  const { createApp } = await import('../../app.js');
  const app = createApp();
  return app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describeIfPg('POST /oauth/register (DCR, MCP OAuth slice U2)', () => {
  const harness = setupPgHarness('silo_api_oauth_register_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../../app.js');
    return { core, app: createApp() };
  });

  it('happy path: 201 with client_id, no client_secret, no auth required', async () => {
    const { app } = harness.mod();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RegisterResponse;
    expect(typeof body.client_id).toBe('string');
    expect(body.client_id.startsWith('cli_')).toBe(true);
    expect(body.client_name).toBe('Claude');
    expect(body.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(typeof body.client_id_issued_at).toBe('number');
    expect(Object.hasOwn(body, 'client_secret')).toBe(false);
  });

  it('carries wildcard CORS headers', async () => {
    const { app } = harness.mod();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://chatgpt.com' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/callback'],
      }),
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('missing client_name: 400 invalid_client_metadata', async () => {
    const res = await register({ redirect_uris: ['https://example.com/cb'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('empty/whitespace client_name: 400 invalid_client_metadata', async () => {
    const res = await register({ client_name: '   ', redirect_uris: ['https://example.com/cb'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('missing redirect_uris: 400 invalid_client_metadata', async () => {
    const res = await register({ client_name: 'Bad Client' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('empty redirect_uris array: 400 invalid_client_metadata', async () => {
    const res = await register({ client_name: 'Bad Client', redirect_uris: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('a malformed redirect_uri: 400 invalid_redirect_uri', async () => {
    const res = await register({ client_name: 'Bad Client', redirect_uris: ['not a url'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('token_endpoint_auth_method other than none: 400 invalid_client_metadata', async () => {
    const res = await register({
      client_name: 'Confidential Client',
      redirect_uris: ['https://example.com/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('non-JSON body: 400 invalid_client_metadata', async () => {
    const { app } = harness.mod();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as OAuthErrorBody;
    expect(body.error).toBe('invalid_client_metadata');
  });
});
