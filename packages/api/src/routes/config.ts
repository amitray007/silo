import type { Hono } from 'hono';

/**
 * `GET /api/config` — an ungated PUBLIC config probe (deployable-silo slice,
 * Unit 4). Register with `registerConfigRoutes(app)` on the ROOT app near
 * `registerAuthRoutes` (`app.ts`), NOT the `/api` sub-app that carries
 * `generalTokenAuth` — same reasoning as `auth.ts`'s `/api/auth/check`: the
 * web app needs to learn the operator-configured MCP URL BEFORE it can know
 * whether the caller is authenticated at all, and an endpoint address is not
 * a secret, so gating it behind the token would only make the "Copy config"
 * button unusable pre-login for no security benefit.
 *
 * Returns `{ mcpUrl? }`: `mcpUrl` is present ONLY when the operator has set
 * `SILO_PUBLIC_MCP_URL` (a deploy-time override for self-hosters whose MCP
 * listener sits behind a different host/port than the `mcp.<hostname>`
 * default the web resolver derives — see `packages/web/src/lib/mcpUrl.ts`).
 * Unset (or blank/whitespace-only) collapses to the key being OMITTED
 * entirely, not `null` — the web resolver's precedence treats "key absent"
 * and "value unset" identically, so there's no reason to distinguish them
 * over the wire. Always 200; this route has no failure path (no DB, no
 * validation to fail).
 *
 * Reads `process.env` directly and TRIMS, rather than reusing
 * `token-auth.ts`'s `readTokenEnv` — that helper deliberately does NOT trim
 * (a bearer secret is compared byte-for-byte, so trimming there would be
 * wrong), but `SILO_PUBLIC_MCP_URL` is a plain config string, not a secret
 * compared for equality, so trimming whitespace-only noise to "unset" here
 * is the correct, independent behavior for this one call site.
 */
export function registerConfigRoutes(app: Hono): void {
  app.get('/api/config', (c) => {
    const raw = process.env.SILO_PUBLIC_MCP_URL?.trim();
    return c.json(raw ? { mcpUrl: raw } : {});
  });
}
