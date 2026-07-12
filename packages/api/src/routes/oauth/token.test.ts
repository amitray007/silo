import { createHash, randomBytes } from 'node:crypto';
import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `POST /oauth/token` — driven via
 * `createApp()` + `app.request(...)` against a real disposable Postgres
 * (mirrors `access-tokens.test.ts`'s harness pattern). Exercises the FULL
 * handshake per request (register -> authorize's `createAuthCode` directly
 * via `core`, bypassing the HTML consent screen which `authorize.test.ts`
 * covers separately -> token exchange), since `/oauth/token` has no
 * meaningful behavior to assert without a real code/client/PKCE pair behind
 * it — mirrors the design doc's "Testing/verification" list (code grant
 * happy path + PKCE failure + replayed code + resource mismatch + redirect_
 * uri mismatch; refresh grant happy path).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const RESOURCE = 'https://mcp.example.com/mcp';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

/** A PKCE verifier + its S256 challenge, generated once per call — mirrors
 * how a real MCP client derives them (RFC 7636). */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(app: Hono, redirectUri = REDIRECT_URI): Promise<string> {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
  });
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function tokenRequest(app: Hono, form: Record<string, string>): Promise<Response> {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

type TokenSuccess = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};
type TokenErrorBody = { error: string; error_description: string };

describeIfPg('POST /oauth/token (MCP OAuth slice U2)', () => {
  const harness = setupPgHarness('silo_api_oauth_token_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../../app.js');
    return { core, app: createApp() };
  });

  it('authorization_code grant happy path: 200 with access/refresh tokens, Cache-Control: no-store', async () => {
    const { core, app } = harness.mod();
    const clientId = await registerClient(app);
    const { verifier, challenge } = pkcePair();
    const code = await core.createAuthCode({
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });

    const res = await tokenRequest(app, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
      resource: RESOURCE,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as TokenSuccess;
    expect(body.access_token.startsWith('oat_')).toBe(true);
    expect(body.refresh_token.startsWith('ort_')).toBe(true);
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe('silo');
  });

  it('a replayed authorization code fails the second time (single-use)', async () => {
    const { core, app } = harness.mod();
    const clientId = await registerClient(app);
    const { verifier, challenge } = pkcePair();
    const code = await core.createAuthCode({
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });

    const form = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
      resource: RESOURCE,
    };
    const first = await tokenRequest(app, form);
    expect(first.status).toBe(200);

    const second = await tokenRequest(app, form);
    expect(second.status).toBe(400);
    const body = (await second.json()) as TokenErrorBody;
    expect(body.error).toBe('invalid_grant');
  });

  it('a wrong code_verifier (PKCE failure) is rejected', async () => {
    const { core, app } = harness.mod();
    const clientId = await registerClient(app);
    const { challenge } = pkcePair();
    const code = await core.createAuthCode({
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });

    const res = await tokenRequest(app, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: 'wrong-verifier-entirely',
      client_id: clientId,
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as TokenErrorBody;
    expect(body.error).toBe('invalid_grant');
  });

  it('a resource mismatch at token exchange is rejected (RFC 8707)', async () => {
    const { core, app } = harness.mod();
    const clientId = await registerClient(app);
    const { verifier, challenge } = pkcePair();
    const code = await core.createAuthCode({
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });

    const res = await tokenRequest(app, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
      resource: 'https://mcp.other-domain.com/mcp',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as TokenErrorBody;
    expect(body.error).toBe('invalid_target');
  });

  it('a redirect_uri mismatch at token exchange is rejected', async () => {
    const { core, app } = harness.mod();
    const clientId = await registerClient(app);
    const { verifier, challenge } = pkcePair();
    const code = await core.createAuthCode({
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });

    const res = await tokenRequest(app, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://claude.ai/some/other/callback',
      code_verifier: verifier,
      client_id: clientId,
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as TokenErrorBody;
    expect(body.error).toBe('invalid_grant');
  });

  it('refresh_token grant happy path: 200 with a fresh token pair; immediate replay within the grace window returns the SAME successor (idempotent)', async () => {
    const { core, app } = harness.mod();
    const clientId = await registerClient(app);
    const { verifier, challenge } = pkcePair();
    const code = await core.createAuthCode({
      clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });
    const issued = (await (
      await tokenRequest(app, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        client_id: clientId,
        resource: RESOURCE,
      })
    ).json()) as TokenSuccess;

    const refreshRes = await tokenRequest(app, {
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
      client_id: clientId,
      resource: RESOURCE,
    });
    expect(refreshRes.status).toBe(200);
    const rotated = (await refreshRes.json()) as TokenSuccess;
    expect(rotated.access_token).not.toBe(issued.access_token);
    expect(rotated.refresh_token).not.toBe(issued.refresh_token);

    // Grace window (refresh reuse tolerance, see core `rotateRefreshToken` /
    // `docs/methods/oauth-refresh-grace-window.md`): a RETRIED refresh of the
    // same old token within the grace window must NOT fail with invalid_grant
    // (which a connector reads as "connection expired"). It returns 200 with
    // the *same* successor pair the first rotation minted — idempotent replay,
    // so a client that retried a slow/dropped refresh converges on one live
    // credential rather than being locked out.
    const replay = await tokenRequest(app, {
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
      client_id: clientId,
      resource: RESOURCE,
    });
    expect(replay.status).toBe(200);
    const replayed = (await replay.json()) as TokenSuccess;
    expect(replayed.access_token).toBe(rotated.access_token);
    expect(replayed.refresh_token).toBe(rotated.refresh_token);
  });

  it('unsupported grant_type: 400 unsupported_grant_type', async () => {
    const { app } = harness.mod();
    const res = await tokenRequest(app, { grant_type: 'password' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as TokenErrorBody;
    expect(body.error).toBe('unsupported_grant_type');
  });

  it('carries wildcard CORS headers', async () => {
    const { app } = harness.mod();
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Origin: 'https://chatgpt.com',
      },
      body: new URLSearchParams({ grant_type: 'password' }).toString(),
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
