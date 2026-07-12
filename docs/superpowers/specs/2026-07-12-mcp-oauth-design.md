# MCP OAuth for silo — design (spec)

**Date:** 2026-07-12
**Branch:** `feat/mcp-oauth` (worktree off `main`)
**Status:** frozen — do not edit during build

## Goal

Let **Claude** and **ChatGPT** apps connect to silo's MCP server via the OAuth setup flow
their connector UIs require (they will not accept a manually-pasted bearer). Implement enough
of the MCP authorization spec — OAuth 2.1 + PKCE (S256) + Dynamic Client Registration (RFC 7591)
+ discovery (RFC 8414 / RFC 9728) + resource indicators (RFC 8707) — that the "Add custom
connector" flow works end to end, while preserving silo's **single-owner** posture. Then surface
**connected clients** in the existing API / MCP settings tab: list who connected, **dedup by
client name**, show granted/last-used/active-token-count, and allow revoke (per-app + revoke-all).

This is a **full vertical slice**: connect + list + dedup + revoke + edge cases. The reference
implementation is `/Users/maverick/code/projects/stash` (`docs/MCP.md` + `lib/auth/oauth.ts`);
we mirror its design and its edge-case handling. There is **no Claude- or ChatGPT-specific
branching** — a spec-pure server serves both.

## Non-goals (parked)

- Multi-user / user accounts (silo stays single-owner; the "user" is the operator).
- Token scopes/permissions beyond the single `silo` scope (all tokens full-access, matching the
  existing access-token model).
- Confidential clients / client secrets (public clients + PKCE only; `token_endpoint_auth_method: none`).
- Changing the existing manual-bearer path or DB access tokens — they keep working unchanged.

## The two-origin adaptation (the one real difference from stash)

Stash is a single Next.js origin. Silo is split across **two containers / two origins**:

- **api** (`silo.<domain>`, Hono) → **authorization server**. Has the DB, the `silo_session`
  cookie, and can render HTML. Hosts: `/.well-known/oauth-authorization-server`,
  `/oauth/register`, `/oauth/authorize` (GET consent + POST approve/deny), `/oauth/token`.
- **mcp** (`mcp.<domain>`, raw `node:http` streamable-HTTP) → **resource server**. Hosts
  `/.well-known/oauth-protected-resource` and does the audience-checked bearer verification on
  `POST /mcp`.

**No redirect crosses between the two origins.** Discovery is client-driven JSON fetches. The
mcp 401 carries a `WWW-Authenticate: Bearer resource_metadata="…"` *header* (not a 302); the
client reads the URL and fetches the api origin itself. RFC 9728 explicitly supports
resource-server ≠ authorization-server. The only real HTTP redirects are (a) within the api
origin (owner → login → back to consent) and (b) out to the client's own `redirect_uri`.

### Cross-origin agreement seams (must hold)

1. **Shared Postgres = shared token store.** api mints (stores SHA-256 hash); mcp verifies via
   DB hash lookup. Both containers already share the DB — no cross-service call, no shared
   signing key.
2. **Audience agreement (RFC 8707).** Both containers must derive the identical canonical
   resource string `https://mcp.<domain>/mcp`. Both read the **existing** `SILO_PUBLIC_MCP_URL`.
   Today only api reads it; wire it into the mcp container too.
3. **Issuer advertisement.** mcp must advertise `authorization_servers: ["https://silo.<domain>"]`
   in protected-resource metadata. Add one new env var `SILO_PUBLIC_API_URL` to the mcp service,
   threaded through `readMcpHttpConfig` exactly like `SILO_MCP_ALLOWED_HOSTS` already is.

## Architecture / where code lives

Respects the core/adapter boundary (`docs/rules/architecture.md`): api and mcp are sibling
adapters and may not import each other; shared logic goes through `@silo/core`.

- **`@silo/core` — `packages/core/src/auth/oauth.ts`** (new): all OAuth core logic, framework-free.
  - `generateOpaque(prefix, bytes)` — opaque token/id generator (mirror existing
    `generateAccessToken` discipline in `packages/core/src/auth/tokens.ts`: prefix + random bytes,
    return raw once).
  - `hashToken(raw)` — SHA-256 (reuse existing helper if present in `tokens.ts`).
  - `verifyPkce(codeVerifier, codeChallenge, method)` — `base64url(sha256(verifier)) === challenge`, S256 only.
  - `registerOAuthClient({ clientName, redirectUris, grantTypes, tokenEndpointAuthMethod })` — DCR insert.
  - `getOAuthClient(clientId)`.
  - `createAuthCode({ clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, resource })`
    — insert `oauth_codes`, TTL 5 min.
  - `consumeAuthCode(code)` — fetch non-expired **and delete (single-use)** atomically.
  - `issueOAuthTokens({ clientId, scope, resource })` — access `oat_`+32B (TTL 1h) + refresh
    `ort_`+32B (TTL 30d); store hashes with `kind`, `client_id`, `expires_at`, `refresh_token_hash`,
    `scope`, `resource`.
  - `rotateRefreshToken({ refreshToken, clientId, resource })` — verify hash + client + not-expired
    + resource-match; delete old access+refresh pair; issue fresh pair.
  - `authenticateOAuthToken(rawToken, canonicalResource)` — hash lookup; require `kind='oauth_access'`
    AND `expires_at > now` AND stored `resource === canonicalResource`; best-effort `last_used_at`.
  - `listOAuthClientsForOwner()` — all `oauth_access` rows joined to client; **dedup by
    `client.name.toLowerCase()`**, collect all `cli_*` ids under each name; per group return
    earliest `granted_at`, latest `last_used_at`, `activeTokenCount` (non-expired), `clientIds[]`,
    `connectionCount`. Sorted most-recently-granted first.
  - `revokeOAuthClient(clientId)` — delete all tokens for that client.
  - `revokeAllOAuthClients()` — delete all `oauth_access` + `oauth_refresh` tokens.
  - `canonicalMcpResource(publicMcpUrl)` — normalize trailing slash → `https://mcp.<domain>/mcp`;
    single source of truth used on both containers.

- **`@silo/db` — `packages/db/src/schema/`** (new tables + migration):
  - `oauth-clients.ts` — `oauth_clients`: `id text pk` (`cli_…`), `name text`, `redirect_uris text[]`,
    `grant_types text[]`, `token_endpoint_auth_method text default 'none'`, `created_at timestamptz`.
  - `oauth-codes.ts` — `oauth_codes`: `code text pk` (`oac_…`), `client_id → oauth_clients.id (cascade)`,
    `redirect_uri text`, `code_challenge text`, `code_challenge_method text`, `scope text default 'silo'`,
    `resource text`, `expires_at timestamptz`, `created_at timestamptz`.
  - Extend the **existing** `access_tokens` table (`packages/db/src/schema/access-tokens.ts`) into
    the unified token store, mirroring stash's `api_tokens`. Add nullable columns:
    `kind text default 'bearer'` (`'bearer' | 'oauth_access' | 'oauth_refresh'`),
    `client_id text → oauth_clients.id (cascade, nullable)`, `expires_at timestamptz null`,
    `refresh_token_hash text null`, `scope text null`, `resource text null`. Existing rows default
    to `kind='bearer'` with the other columns null — no behavior change for current tokens.
  - One new Drizzle migration (`drizzle-kit generate`); applied idempotently on container boot as today.

- **`@silo/api` — authorization-server routes** registered **on the root `app`** (ungated),
  **before** `app.route('/api', api)` and **before** the SPA catch-all, in `packages/api/src/app.ts`.
  New files under `packages/api/src/routes/oauth/`:
  - `well-known.ts` — `GET /.well-known/oauth-authorization-server` → `{ issuer, authorization_endpoint,
    token_endpoint, registration_endpoint, response_types_supported:['code'],
    grant_types_supported:['authorization_code','refresh_token'],
    code_challenge_methods_supported:['S256'], token_endpoint_auth_methods_supported:['none'],
    scopes_supported:['silo'] }`. `issuer`/endpoints derived from the request origin (Host +
    `x-forwarded-proto`/`x-forwarded-host`), falling back to `SILO_PUBLIC_API_URL`.
  - `register.ts` — `POST /oauth/register` (DCR). Validates `client_name` (required, non-empty),
    `redirect_uris` (required non-empty array, each `new URL()`-valid), `token_endpoint_auth_method`
    (only `'none'`; else 400 `invalid_client_metadata`). Returns 201 `{ client_id, client_name,
    redirect_uris, grant_types, token_endpoint_auth_method, client_id_issued_at }`. **No client_secret.**
  - `authorize.ts` — `GET /oauth/authorize`: validate params **before** any redirect (open-redirector
    guard): required `client_id`/`redirect_uri`/`code_challenge`; `response_type==='code'`;
    `code_challenge_method==='S256'`; RFC-8707 `resource` must equal `canonicalMcpResource(...)`;
    client exists; `redirect_uri` ∈ client allowlist. Then check `silo_session` cookie
    (validated server-side exactly like `/api/auth/check`): if absent, render a **server-rendered
    login prompt** (posts password to a small login handler, then re-renders consent — all on the
    api origin, no SPA/`?next=` machinery); if present, render the **server-rendered consent
    screen** (client name, "is requesting access to your silo library", Approve/Deny). `POST
    /oauth/authorize` approve → `createAuthCode` → 302 to `redirect_uri?code=…&state=…`; deny → 302
    to `redirect_uri?error=access_denied&state=…`. All HTML via Hono `c.html()`, styled to the Oat
    tokens (Geist, warm ramp — no AI-slop defaults).
  - `token.ts` — `POST /oauth/token` (`application/x-www-form-urlencoded`, `Cache-Control: no-store`).
    `authorization_code` grant: `consumeAuthCode` (single-use) → check `client_id` + `redirect_uri`
    + `verifyPkce` + RFC-8707 `resource` match → `issueOAuthTokens`. `refresh_token` grant →
    `rotateRefreshToken`. Response `{ access_token, refresh_token, token_type:'Bearer', expires_in,
    scope }`.
  - `oauth-cors.ts` — a **separate** `oauthCorsMiddleware()` emitting `Access-Control-Allow-Origin: *`
    + OPTIONS on every OAuth/well-known route. **Do NOT modify `packages/api/src/cors.ts`** — that
    module is the security boundary for `/api/*` and must never emit `*`.
  - `access-tokens.ts` route (existing) gains: `GET /api/access-tokens/oauth-clients` (list, deduped),
    `DELETE /api/access-tokens/oauth-clients/:clientId` (revoke one),
    `DELETE /api/access-tokens/oauth-clients` (revoke all). These are **gated** (owner-only, under
    `generalTokenAuth`), unlike the OAuth handshake routes.

- **`@silo/app` — resource server**, `packages/app/src/mcp-http.ts` + `mcp-http-main.ts`:
  - Add `GET /.well-known/oauth-protected-resource` branch in `routeMcpRequest` → `{ resource:
    canonicalMcpResource, authorization_servers:[SILO_PUBLIC_API_URL], scopes_supported:['silo'],
    bearer_methods_supported:['header'] }` + wildcard CORS + OPTIONS.
  - Extend the bearer check: keep env-token + `verifyAccessToken` (legacy `bearer`), and **add**
    `authenticateOAuthToken(token, canonicalResource)` for `oat_` tokens (audience-checked). On any
    failure, `sendUnauthorized` now emits `WWW-Authenticate: Bearer resource_metadata="<mcp-origin>/.well-known/oauth-protected-resource"`
    (keep the body uninformative — no auth oracle).
  - `readMcpHttpConfig()` + `McpHttpConfig` gain `publicMcpUrl` (from `SILO_PUBLIC_MCP_URL`) and
    `publicApiUrl` (from new `SILO_PUBLIC_API_URL`), threaded into `startMcpHttpServer`.

- **`@silo/web` — connected clients UI**, extend `packages/web/src/components/SettingsTabs/AccessTab.tsx`:
  - New "Connected apps" section below the existing token management: driven by a new
    `useOAuthClients()` hook (`GET /api/access-tokens/oauth-clients`). Each **deduped** row shows
    name, granted date, last-used (or "never"), active token count, and `(N connections)` when
    `connectionCount > 1`. Per-row **Revoke** (fans out over all `clientIds`), plus a **Revoke all**
    action. Empty state when none. Mirror types in `packages/web/src/api/types.ts` (web can't import core).
  - The existing `McpSetupDialog` gains a short note that Claude/ChatGPT connect via URL-only OAuth
    (no header paste) — the manual bearer stays documented as the curl/script fallback.

## Config / deployment changes

- **`SILO_PUBLIC_MCP_URL`** — now also read by the **mcp** container (add to `mcp` service env in
  `docker-compose.prod.yml`; add to `readMcpHttpConfig`). Same value both containers already agree on.
- **`SILO_PUBLIC_API_URL`** (new, e.g. `https://silo.<domain>`) — added to the **mcp** service env
  (for protected-resource `authorization_servers`) and optionally to api (issuer fallback). Wire in
  `docker-compose.prod.yml`, `readMcpHttpConfig`, and `.env.example`.
- Both `.well-known` + `/oauth/*` routes must be reachable through the reverse proxy unauthenticated.

## Edge cases (ported from stash — build these explicitly)

- **Re-registration noise:** Claude/ChatGPT run DCR on every connect → fresh `client_id` each time.
  The connected-apps list **dedups by lowercased client name**, collapsing dozens of `cli_*` into one
  "Claude" / "ChatGPT" row with a connection count. Revoke fans out over every id in the group.
- **Single-use codes:** `consumeAuthCode` deletes on read; a replayed code fails.
- **PKCE required:** only S256 advertised/accepted; missing/plain → error.
- **Open-redirector guard:** validate `client_id` + `redirect_uri` allowlist **before** issuing any
  redirect; unknown client / non-allowlisted redirect → render an error page, never redirect.
- **Audience confusion (RFC 8707):** `resource` bound into the code, re-checked at token exchange,
  and re-checked on every mcp request; a token minted for another resource is rejected at mcp.
- **Refresh rotation:** old access+refresh pair deleted on refresh; stolen old refresh can't be reused.
- **Token/secret hygiene:** only SHA-256 hashes stored; raw returned once; 401s stay uninformative.
- **CORS:** wildcard + OPTIONS on all handshake/discovery routes (ChatGPT fetches from a browser
  origin); `WWW-Authenticate` exposed so browser clients can read it.
- **Revoke semantics:** revoke deletes tokens (app disappears from the list, which is token-driven);
  the `oauth_clients` row may remain (harmless — a stale client with no tokens).
- **Legacy tokens untouched:** existing `access_tokens` become `kind='bearer'`; env-token +
  DB-bearer verification unchanged; the manual-bearer MCP path keeps working.

## Testing / verification

- **core** (`packages/core/src/auth/oauth.test.ts`): PKCE S256 verify (pos/neg), single-use code
  consume, refresh rotation (old pair invalidated), audience mismatch rejected, name-dedup grouping
  (multiple `cli_*` same name → one group, correct counts/dates), revoke helpers.
- **api** (route tests): DCR validation (bad redirect_uri, non-`none` auth method → 400); `/authorize`
  param validation + open-redirector guard + resource check; `/token` code grant happy path + PKCE
  failure + replayed code + resource mismatch; refresh grant; wildcard CORS + OPTIONS present;
  well-known JSON shape.
- **app** (`packages/app/src/mcp-http.test.ts`): protected-resource metadata JSON;
  `WWW-Authenticate` now carries `resource_metadata`; `oat_` token accepted only with matching
  audience; legacy bearer still works.
- **End-to-end QA (real Postgres):** drive the full bootstrap by hand (curl the 401 → fetch both
  well-knowns → register → authorize with a cookie → token exchange → authenticated `/mcp` call →
  refresh), then confirm the connected-apps list dedups and revoke works. Per the review protocol,
  exercise happy + edge + failure paths against real infra, not just unit tests.
- Quality gate green (`check-types` + `test` + `quality`) on this worktree's own changes.

## Build order (independent-ish units, foundation first)

1. **DB foundation** (solo, first): schema (`oauth_clients`, `oauth_codes`, extend `access_tokens`)
   + migration + `@silo/core/auth/oauth.ts` core logic + core tests. This is the interface layer
   everything else builds on — no fan-out until it's stable.
2. **api authorization server**: well-known + register + authorize (consent HTML) + token + oauth-cors,
   wired into `app.ts`; route tests.
3. **mcp resource server**: protected-resource metadata + oauth token verification + `WWW-Authenticate`
   + config threading; app tests.
4. **web connected-apps UI**: AccessTab section + hook + wire types.
5. **config/docs**: `docker-compose.prod.yml`, `.env.example`, `docs/methods/mcp-oauth.md`.

Then: independent review (ce-code-review personas) + intense QA + resolve issues + re-run gate.
