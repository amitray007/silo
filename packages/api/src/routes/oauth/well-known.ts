import type { Context, Hono } from 'hono';

/**
 * Derives THIS request's origin (`scheme://host`) for the metadata's
 * `issuer`/endpoint URLs — RFC 8414 requires `issuer` to match what the
 * client actually reached, so it's computed from the request itself rather
 * than solely from config. Prefers `x-forwarded-proto`/`x-forwarded-host`
 * (the standard reverse-proxy signal — same discipline as `routes/login.ts`'s
 * `isHttpsRequest`) over the raw request URL (which reflects the LOCAL
 * scheme/host inside a container, not the public one a proxy fronts), then
 * falls back to `SILO_PUBLIC_API_URL` when neither header is present (e.g. a
 * bare `curl` straight at the process with no proxy in front and no `Host`
 * override).
 */
function requestOrigin(c: Context): string {
  const forwardedHost = c.req.header('x-forwarded-host');
  const forwardedProto = c.req.header('x-forwarded-proto');
  if (forwardedHost) {
    const proto = forwardedProto ?? 'https';
    return `${proto}://${forwardedHost}`;
  }

  const configured = process.env.SILO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * `GET /.well-known/oauth-authorization-server` (RFC 8414) — the discovery
 * document an MCP client (Claude/ChatGPT's connector UI) fetches first to
 * learn where `/oauth/register`, `/oauth/authorize`, and `/oauth/token` live.
 * Registered on the ROOT app in `app.ts`, wrapped in `oauthCorsMiddleware()`
 * (wildcard — see that module's doc comment), ungated (discovery is public
 * metadata by design, RFC 8414/9728).
 *
 * Every field here is a fixed capability declaration EXCEPT the four
 * origin-derived URLs (`issuer`, `authorization_endpoint`, `token_endpoint`,
 * `registration_endpoint`) — see `requestOrigin` above for how those are
 * computed. `scopes_supported` is the single `silo` scope (no
 * scopes/permissions model beyond it — see the design's non-goals).
 */
export function registerOAuthWellKnownRoutes(app: Hono): void {
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const origin = requestOrigin(c);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['silo'],
    });
  });
}
