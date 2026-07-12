import { consumeAuthCode, issueOAuthTokens, rotateRefreshToken, verifyPkce } from '@silo/core';
import type { Context, Hono } from 'hono';

/** Same OAuth-spec error shape as `register.ts`'s `oauthError` — see that
 * module's doc comment for why this surface uses `{error, error_description}`
 * rather than silo's own `ErrorEnvelope`. */
function tokenError(c: Context, error: string, description: string, status: 400 = 400): Response {
  c.header('Cache-Control', 'no-store');
  return c.json({ error, error_description: description }, status);
}

/** Strips a single trailing slash — the same normalization the client-
 * supplied `resource` param needs before comparing against
 * `canonicalMcpResource`'s already-normalized output (mirrors stash's
 * `resource?.replace(/\/$/, '')`). */
function normalizeResource(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

/** The `authorization_code` grant branch of `POST /oauth/token` — split out
 * from the route handler purely to keep the handler's own cognitive
 * complexity under the project's lint threshold; the logic (consume ->
 * client/redirect_uri/PKCE/resource checks -> issue) is unchanged. See the
 * route's own doc comment below for the full behavioral description. */
async function handleAuthorizationCodeGrant(c: Context, form: URLSearchParams): Promise<Response> {
  const code = form.get('code');
  const redirectUri = form.get('redirect_uri');
  const codeVerifier = form.get('code_verifier');
  const clientId = form.get('client_id');
  const resource = normalizeResource(form.get('resource'));

  if (!code || !redirectUri || !codeVerifier || !clientId) {
    return tokenError(
      c,
      'invalid_request',
      'Missing required parameters: code, redirect_uri, code_verifier, client_id',
    );
  }

  const codeRow = await consumeAuthCode(code);
  if (!codeRow) {
    return tokenError(c, 'invalid_grant', 'Authorization code is invalid or expired');
  }

  if (codeRow.clientId !== clientId) {
    return tokenError(c, 'invalid_grant', 'client_id mismatch');
  }

  if (codeRow.redirectUri !== redirectUri) {
    return tokenError(c, 'invalid_grant', 'redirect_uri mismatch');
  }

  if (!verifyPkce(codeVerifier, codeRow.codeChallenge, codeRow.codeChallengeMethod)) {
    return tokenError(c, 'invalid_grant', 'PKCE verification failed');
  }

  if (!resource || resource !== codeRow.resource) {
    return tokenError(
      c,
      'invalid_target',
      'Resource parameter missing or does not match the authorization request',
    );
  }

  const tokens = await issueOAuthTokens({
    clientId: codeRow.clientId,
    scope: codeRow.scope,
    resource,
  });

  c.header('Cache-Control', 'no-store');
  return c.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: 'Bearer',
    expires_in: tokens.accessExpiresIn,
    scope: tokens.scope,
  });
}

/** The `refresh_token` grant branch of `POST /oauth/token` — same
 * complexity-reduction split as `handleAuthorizationCodeGrant`. */
async function handleRefreshTokenGrant(c: Context, form: URLSearchParams): Promise<Response> {
  const refreshToken = form.get('refresh_token');
  const clientId = form.get('client_id');
  const resource = normalizeResource(form.get('resource'));

  if (!refreshToken || !clientId) {
    return tokenError(
      c,
      'invalid_request',
      'Missing required parameters: refresh_token, client_id',
    );
  }

  if (!resource) {
    return tokenError(
      c,
      'invalid_target',
      'Resource parameter missing or does not match the authorization request',
    );
  }

  const rotated = await rotateRefreshToken({ refreshToken, clientId, resource });
  if (!rotated) {
    return tokenError(
      c,
      'invalid_grant',
      'Refresh token is invalid, expired, or client_id mismatch',
    );
  }

  c.header('Cache-Control', 'no-store');
  return c.json({
    access_token: rotated.accessToken,
    refresh_token: rotated.refreshToken,
    token_type: 'Bearer',
    expires_in: rotated.accessExpiresIn,
    scope: rotated.scope,
  });
}

/**
 * `POST /oauth/token` — the OAuth 2.1 token endpoint. Body is
 * `application/x-www-form-urlencoded` per spec (not JSON). Every response
 * (success or error) sets `Cache-Control: no-store` — a token response must
 * never be cached. Registered on the ROOT app in `app.ts`, wrapped in
 * `oauthCorsMiddleware()`.
 *
 * Two grant types, dispatched on the `grant_type` form field:
 *
 * - `authorization_code` (`handleAuthorizationCodeGrant`): `consumeAuthCode`
 *   (single-use — a replayed code fails here) -> verify `client_id` matches
 *   the code's -> verify `redirect_uri` matches the code's ->
 *   `verifyPkce(code_verifier, codeRow.codeChallenge, 'S256')` -> verify the
 *   RFC 8707 `resource` param matches the code's bound resource ->
 *   `issueOAuthTokens`.
 * - `refresh_token` (`handleRefreshTokenGrant`): `rotateRefreshToken` does
 *   its own client/expiry/resource verification internally (returns `null`
 *   on ANY failure, OAUTH-INTERFACES.md) -> same response shape.
 *
 * The canonical MCP resource string isn't recomputed here — the resource
 * check is against what was already bound to the code at `/oauth/authorize`
 * time (which itself validated against `canonicalMcpResource(...)` — see
 * `authorize.ts`), so this route only needs to confirm the TOKEN request's
 * `resource` param agrees with what the CODE carries, after the same
 * trailing-slash normalization (`normalizeResource`) stash's route applies.
 */
export function registerOAuthTokenRoutes(app: Hono): void {
  app.post('/oauth/token', async (c) => {
    let form: URLSearchParams;
    try {
      const raw = await c.req.text();
      form = new URLSearchParams(raw);
    } catch {
      return tokenError(c, 'invalid_request', 'Failed to parse request body');
    }

    const grantType = form.get('grant_type');

    if (grantType === 'authorization_code') {
      return handleAuthorizationCodeGrant(c, form);
    }

    if (grantType === 'refresh_token') {
      return handleRefreshTokenGrant(c, form);
    }

    return tokenError(
      c,
      'unsupported_grant_type',
      `grant_type '${grantType ?? '(missing)'}' is not supported. Use 'authorization_code' or 'refresh_token'.`,
    );
  });
}
