# MCP OAuth

Lets **Claude** and **ChatGPT** connect to silo's MCP server with a URL-only "Add custom
connector" flow — paste `https://mcp.<domain>/mcp`, no manual bearer-token paste. Implements
enough of the MCP authorization spec — OAuth 2.1 + PKCE (S256), Dynamic Client Registration
(RFC 7591), discovery (RFC 8414 / RFC 9728), and resource indicators (RFC 8707) — for that flow
to work end to end, while keeping silo's single-owner posture (no user accounts, no scopes
beyond `silo`, no client secrets). The reference implementation is
[stash](https://github.com/amitray007/stash)'s `docs/MCP.md` + `lib/auth/oauth.ts`; this mirrors
its design and edge-case handling. There is no Claude- or ChatGPT-specific branching — one
spec-pure server serves both.

The existing manual-bearer path (`SILO_API_TOKEN` / DB access tokens pasted as an
`Authorization: Bearer` header) is unchanged and keeps working — OAuth is additive, not a
replacement.

## The two-origin architecture

Silo is split across two containers / two origins, and OAuth respects that split:

- **api** (`silo.<domain>`) — the **authorization server**. Has the DB and the `silo_session`
  cookie, and can render HTML. Hosts `/.well-known/oauth-authorization-server`,
  `/oauth/register`, `/oauth/authorize` (consent), `/oauth/token`.
- **mcp** (`mcp.<domain>`) — the **resource server**. Hosts
  `/.well-known/oauth-protected-resource` and does the audience-checked bearer verification on
  `POST /mcp`.

**No redirect crosses between the two origins.** Discovery is client-driven JSON fetches: the
mcp server's `401` response carries a `WWW-Authenticate: Bearer resource_metadata="…"`
**header** (not a redirect) pointing back at the api origin, and the client fetches it itself.
RFC 9728 explicitly supports resource-server ≠ authorization-server. The only real HTTP
redirects are within the api origin (owner login → consent) and out to the client's own
`redirect_uri`.

This works because both containers share one Postgres — api mints tokens (storing only a
SHA-256 hash), mcp verifies by hashing the incoming token and looking it up. No cross-service
call, no shared signing key.

## Bootstrap sequence

1. Claude/ChatGPT `POST /mcp` with no (or a stale) bearer token → mcp returns `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://mcp.<domain>/.well-known/oauth-protected-resource"`.
2. Client fetches that URL → `GET /.well-known/oauth-protected-resource` (on **mcp**) → JSON
   naming the canonical `resource` and the `authorization_servers` (the api origin).
3. Client fetches `GET /.well-known/oauth-authorization-server` (on **api**) → RFC 8414 metadata:
   `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, supported grant types /
   PKCE methods / scopes.
4. Client self-registers: `POST /oauth/register` (RFC 7591, on **api**) → a fresh `client_id`,
   no secret (public client, `token_endpoint_auth_method: none`).
5. Client opens a browser to `GET /oauth/authorize` (on **api**) with PKCE `code_challenge` +
   the RFC 8707 `resource` param. The owner logs in (if no `silo_session` cookie yet) and sees a
   server-rendered consent screen — "`<client name>` is requesting access to your silo
   library" — Approve or Deny.
6. On Approve, api issues a single-use authorization code and `302`s to the client's
   `redirect_uri?code=…&state=…`.
7. Client exchanges the code at `POST /oauth/token` (on **api**) — verifies PKCE, the
   `resource` match, and that the code hasn't been used before — and gets back an access +
   refresh token pair.
8. Client calls `POST /mcp` (on **mcp**) with `Authorization: Bearer oat_…` — mcp verifies the
   token's hash, expiry, and that its bound `resource` matches this mcp server's own canonical
   resource string. Calls succeed.
9. When the access token expires (1h), the client transparently exchanges the refresh token
   (`ort_…`) at `POST /oauth/token` for a fresh pair — no re-consent, no browser popup. The old
   pair is invalidated on rotation.

## Endpoints

| Method | Path | Container | Purpose |
|---|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | api | RFC 8414 authorization-server metadata |
| GET | `/.well-known/oauth-protected-resource` | mcp | RFC 9728 protected-resource metadata |
| POST | `/oauth/register` | api | RFC 7591 dynamic client registration |
| GET / POST | `/oauth/authorize` | api | Login (if needed) + consent screen; approve/deny |
| POST | `/oauth/token` | api | Token endpoint — `authorization_code` and `refresh_token` grants |
| POST | `/mcp` | mcp | The MCP endpoint itself — accepts `oat_…` (OAuth) and legacy `silo_…` bearers |

All six are reachable through the reverse proxy **unauthenticated** — they're the handshake
itself, not something the handshake gates. The well-known and OAuth routes emit wildcard CORS
(`Access-Control-Allow-Origin: *` + `OPTIONS`) since ChatGPT's discovery runs from a browser
origin; this is a separate CORS path from `/api/*`'s allowlist-based CORS and does not loosen it.

## Token model

| Prefix | Kind | TTL | Issued by |
|---|---|---|---|
| `oat_` | OAuth access token | 1 hour, auto-refreshed | `/oauth/token` |
| `ort_` | OAuth refresh token | 30 days, rotating (old pair invalidated on use) | `/oauth/token` |
| `silo_` | Legacy manual bearer | none (until revoked) | Settings → API / MCP → Generate token |

All three are stored as SHA-256 hashes only — raw values are returned exactly once, at
issuance, and never retrievable again. Every OAuth token carries `scope: 'silo'` (the only
scope silo has — full access, matching the existing access-token model) and is bound to an RFC
8707 `resource` (the canonical `https://mcp.<domain>/mcp` string), re-checked at refresh time
and on every mcp request — a token minted for a different resource is rejected.

## Config

Set these on deployment (see `.env.example` for the full annotated list):

| Var | Container(s) | What |
|---|---|---|
| `SILO_PUBLIC_MCP_URL` | **api and mcp** | The canonical `https://mcp.<domain>/mcp` resource string. Both containers must be set to the **identical** value — it's the RFC 8707 audience both sides check against. Previously api-only; the mcp container now reads it too. |
| `SILO_PUBLIC_API_URL` | mcp (and optionally api) | The public origin of the api/auth-server (e.g. `https://silo.example.com`). Used as the OAuth `issuer` and advertised in mcp's protected-resource metadata as `authorization_servers`. |
| `SILO_MCP_ALLOWED_HOSTS` | mcp | Unrelated to OAuth itself but required for the same reverse-proxy deployment — the MCP SDK's DNS-rebinding allowlist (see `docs/deploy.md`). |

Both `.well-known/*` and `/oauth/*` must be reachable through the reverse proxy
**unauthenticated** — don't put them behind Traefik/Dokploy basic-auth or an IP allowlist, or
the discovery handshake breaks before it starts.

## Connected apps

Managed in **Settings → API / MCP**, below the existing manual-token management. Because
Claude/ChatGPT re-run Dynamic Client Registration on every connect (fresh `client_id` each
time), the list **dedups by client name** (case-insensitive) — dozens of registrations collapse
into one "Claude" / "ChatGPT" row showing granted date, last-used, active token count, and a
`(N connections)` note when re-registration happened more than once. Each row has **Revoke**
(deletes every token under every `client_id` in that group); there's also a **Revoke all**
action. Revoking deletes tokens only — the `oauth_clients` row may remain (harmless, no tokens
attached). Revoking never touches the legacy `silo_…` manual-bearer tokens.
