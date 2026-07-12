import { registerOAuthClient } from '@silo/core';
import type { Hono } from 'hono';

/** Size caps on DCR input — this endpoint is unauthenticated by design (see
 * the route doc comment), so it's the only backstop against a client
 * registering absurdly large metadata. Values are generous for any real
 * connector (Claude/ChatGPT register one redirect_uri, a short name). */
const MAX_CLIENT_NAME_LENGTH = 256;
const MAX_REDIRECT_URIS = 20;

/** A DCR (RFC 7591) protocol error body — `{ error, error_description }`, the
 * OAuth-spec shape, DISTINCT from this API's own `ErrorEnvelope`
 * (`{error, message}`) used everywhere else under `/api/*`. The OAuth
 * handshake surface speaks the OAuth spec's own error vocabulary throughout
 * (register/authorize/token all use `error`/`error_description`), not
 * silo's internal envelope — a client here is a generic OAuth library, not
 * silo's own web app. */
function oauthError(
  error: string,
  description: string,
): { error: string; error_description: string } {
  return { error, error_description: description };
}

type ParsedClientMetadata = {
  clientName: string;
  redirectUris: string[];
  grantTypes?: string[];
  tokenEndpointAuthMethod?: string;
};

/** Validates one `redirect_uris` entry — split out of `parseClientMetadata`
 * purely to keep that function's own cognitive complexity under the
 * project's lint threshold. Checks it's a string, a valid URL, and restricted
 * to `http:`/`https:` (`new URL()` alone happily accepts `javascript:`/
 * `data:`/etc, and this value is later redirected to verbatim from
 * `/oauth/authorize` once a user approves). `http:` stays allowed for
 * localhost dev callbacks; custom native-app schemes are out of scope for
 * silo's connectors (see the review that flagged this). */
function validateRedirectUri(
  uri: unknown,
):
  | { ok: true; value: string }
  | { ok: false; error: { error: string; error_description: string } } {
  if (typeof uri !== 'string') {
    return {
      ok: false,
      error: oauthError('invalid_client_metadata', 'Each redirect_uri must be a string'),
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, error: oauthError('invalid_redirect_uri', `Invalid redirect_uri: ${uri}`) };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: oauthError('invalid_redirect_uri', `redirect_uri must use http or https: ${uri}`),
    };
  }
  return { ok: true, value: uri };
}

/** Validates a DCR request body against the rules `registerOAuthRegisterRoutes`
 * documents (client_name/redirect_uris/token_endpoint_auth_method) — split out
 * from the route handler purely to keep the handler's own cognitive
 * complexity under the project's lint threshold; the validation logic itself
 * is unchanged. Returns either the parsed metadata or the `{error,
 * error_description}` body + status to send back. */
function parseClientMetadata(
  body: Record<string, unknown>,
):
  | { ok: true; value: ParsedClientMetadata }
  | { ok: false; error: { error: string; error_description: string } } {
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  if (!clientName) {
    return { ok: false, error: oauthError('invalid_client_metadata', 'client_name is required') };
  }
  if (clientName.length > MAX_CLIENT_NAME_LENGTH) {
    return {
      ok: false,
      error: oauthError(
        'invalid_client_metadata',
        `client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters`,
      ),
    };
  }

  const rawUris = body.redirect_uris;
  if (!Array.isArray(rawUris) || rawUris.length === 0) {
    return {
      ok: false,
      error: oauthError('invalid_client_metadata', 'redirect_uris must be a non-empty array'),
    };
  }
  if (rawUris.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      error: oauthError(
        'invalid_client_metadata',
        `redirect_uris must contain at most ${MAX_REDIRECT_URIS} entries`,
      ),
    };
  }

  const redirectUris: string[] = [];
  for (const uri of rawUris) {
    const validated = validateRedirectUri(uri);
    if (!validated.ok) return validated;
    redirectUris.push(validated.value);
  }

  let grantTypes: string[] | undefined;
  if (Array.isArray(body.grant_types)) {
    grantTypes = body.grant_types.filter((g): g is string => typeof g === 'string');
  }

  let tokenEndpointAuthMethod: string | undefined;
  if (typeof body.token_endpoint_auth_method === 'string') {
    if (body.token_endpoint_auth_method !== 'none') {
      return {
        ok: false,
        error: oauthError(
          'invalid_client_metadata',
          'Only token_endpoint_auth_method=none is supported (public clients)',
        ),
      };
    }
    tokenEndpointAuthMethod = 'none';
  }

  return {
    ok: true,
    value: {
      clientName,
      redirectUris,
      ...(grantTypes !== undefined && { grantTypes }),
      ...(tokenEndpointAuthMethod !== undefined && { tokenEndpointAuthMethod }),
    },
  };
}

/**
 * `POST /oauth/register` — Dynamic Client Registration (RFC 7591). Claude/
 * ChatGPT's connector UI calls this once per connect attempt with NO prior
 * credential (public, ungated by design — DCR itself is the trust boundary:
 * anyone can register a client, but a client can do nothing without a user's
 * explicit consent at `/oauth/authorize`). Registered on the ROOT app in
 * `app.ts`, wrapped in `oauthCorsMiddleware()`.
 *
 * Validates BEFORE calling core (core's `registerOAuthClient` does not
 * itself validate `tokenEndpointAuthMethod` — see `OAUTH-INTERFACES.md`):
 * - `client_name`: required, non-empty after trim, at most
 *   `MAX_CLIENT_NAME_LENGTH` chars.
 * - `redirect_uris`: required, non-empty array of at most `MAX_REDIRECT_URIS`
 *   entries, every entry a `new URL()`-valid string using the `http:`/
 *   `https:` scheme (rejects `javascript:`/`data:`/etc — this value is later
 *   redirected to verbatim once a user approves at `/oauth/authorize`).
 * - `token_endpoint_auth_method`: if present, must be exactly `'none'` (silo
 *   only supports public clients + PKCE — no client secrets). Absent is
 *   fine; core defaults it to `'none'`.
 *
 * Returns `201` with `{ client_id, client_name, redirect_uris, grant_types,
 * token_endpoint_auth_method, client_id_issued_at }` — NO `client_secret`
 * (public client). `client_id_issued_at` is Unix seconds per RFC 7591.
 */
export function registerOAuthRegisterRoutes(app: Hono): void {
  app.post('/oauth/register', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(oauthError('invalid_client_metadata', 'Request body must be JSON'), 400);
    }

    const parsed = parseClientMetadata(body);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    const client = await registerOAuthClient(parsed.value);

    return c.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      },
      201,
    );
  });
}
