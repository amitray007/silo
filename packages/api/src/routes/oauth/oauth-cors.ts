import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

/**
 * A SEPARATE, wildcard CORS middleware for the OAuth handshake/discovery
 * surface only (`.well-known/oauth-authorization-server`, `/oauth/register`,
 * `/oauth/authorize`, `/oauth/token` — MCP OAuth slice, U2). Deliberately its
 * own module rather than a `corsMiddleware()` option: `../../cors.ts` is the
 * security boundary for `/api/*` and must NEVER emit `Access-Control-Allow-
 * Origin: *` (see that module's doc comment) — mixing the two policies into
 * one function would risk the wildcard leaking onto the gated surface by a
 * future refactor. This module is the one place in the codebase permitted to
 * emit a wildcard, and it stays scoped to the handful of routes that need it.
 *
 * WHY wildcard here specifically: ChatGPT's/Claude's connector UI fetches
 * these routes directly from a BROWSER origin it controls (not silo's own web
 * app), which this API cannot enumerate in advance the way it can
 * `SILO_ALLOWED_ORIGINS` for its own first-party UI — the OAuth spec's
 * client-registration model assumes exactly this (any client can discover
 * and register itself; DCR is the trust boundary, not CORS). None of these
 * routes are readable-without-consent secrets: discovery is public metadata,
 * registration requires no prior credential by design (RFC 7591), and
 * `/authorize`/`/token` both still require the caller to already hold
 * everything they'd need (a valid code + PKCE verifier) — a wildcard origin
 * here widens WHO can read the response, not what the response can do.
 */
export function oauthCorsMiddleware(): MiddlewareHandler {
  return cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
}
