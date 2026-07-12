# MCP OAuth — foundation interface contract (Unit 1)

**Status:** built and green (`@silo/db` + `@silo/core` only). Downstream builders (api, mcp,
web) build against this contract WITHOUT reading `packages/core/src/auth/oauth.ts`'s internals.

See `docs/superpowers/specs/2026-07-12-mcp-oauth-design.md` for the full frozen design this
implements.

## `@silo/db` — new/extended schema

Import via `@silo/db`'s barrel (`import { oauthClients, oauthCodes, accessTokens } from '@silo/db'`).

### `oauthClients` (`packages/db/src/schema/oauth-clients.ts`, table `oauth_clients`)

```ts
{
  id: string;                        // pk, `cli_` + 24 random bytes hex
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;   // default 'none'
  createdAt: Date;
}
```

### `oauthCodes` (`packages/db/src/schema/oauth-codes.ts`, table `oauth_codes`)

```ts
{
  code: string;                      // pk, `oac_` + 24 random bytes hex
  clientId: string;                  // FK -> oauth_clients.id, ON DELETE CASCADE
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;       // always 'S256' in practice
  scope: string;                     // default 'silo'
  resource: string | null;
  expiresAt: Date;
  createdAt: Date;
}
```

Consumed (fetched + deleted) exclusively via `core`'s `consumeAuthCode` — nothing else should
read/write this table directly.

### `accessTokens` extended (`packages/db/src/schema/access-tokens.ts`, table `access_tokens`)

The EXISTING table gained 6 new nullable/defaulted columns. Existing rows are unaffected
(`kind` backfills to `'bearer'`, the rest stay `null`).

```ts
{
  // ...existing columns unchanged: id, name, tokenHash, tokenPrefix, createdAt, lastUsedAt
  kind: string;                      // NOT NULL, default 'bearer' — 'bearer' | 'oauth_access' | 'oauth_refresh'
  clientId: string | null;           // FK -> oauth_clients.id, ON DELETE CASCADE, nullable
  expiresAt: Date | null;            // null for 'bearer' (never expires); set for oauth_* rows
  refreshTokenHash: string | null;   // set ONLY on the 'oauth_access' row of a pair
  scope: string | null;              // set for oauth_* rows, currently always 'silo'
  resource: string | null;           // set for oauth_* rows — RFC 8707 canonical resource URL
}
```

**Migration:** `packages/db/drizzle/0010_late_cloak.sql` (purely additive: 2 new tables + 6 new
nullable/defaulted columns on `access_tokens` + 2 new FKs). No existing column/type was dropped
(the raw drizzle-kit output had a spurious `DROP TYPE` for `link_origin`/`capture_source` —
hand-fixed, see the migration file's header comment; same known class of bug as 0004/0008/0009).

## `@silo/core` — `packages/core/src/auth/oauth.ts`

All exported from `@silo/core`'s barrel too (`import { ... } from '@silo/core'`).

```ts
// --- Primitives ---

/** `prefix` + `bytes` random bytes as hex. Default bytes = 32. */
function generateOpaque(prefix: string, bytes?: number): string;

/** SHA-256 hex digest. */
function hashToken(raw: string): string;

/** S256-only PKCE verify: base64url(sha256(verifier)) === challenge. Any other method -> false. */
function verifyPkce(verifier: string, challenge: string, method: string): boolean;

/** Normalizes a public MCP URL to the canonical RFC 8707 resource string (strips trailing
 * slash, ensures it ends in `/mcp`). Single source of truth for BOTH api and mcp containers. */
function canonicalMcpResource(publicMcpUrl: string): string;

// --- Client registration (RFC 7591) ---

type OAuthClient = {
  id: string; name: string; redirectUris: string[]; grantTypes: string[];
  tokenEndpointAuthMethod: string; createdAt: Date;
};

/** Inserts a new public client. Caller must reject non-'none' tokenEndpointAuthMethod BEFORE
 * calling — this function does not itself validate it. Defaults: grantTypes =
 * ['authorization_code','refresh_token'], tokenEndpointAuthMethod = 'none'. */
function registerOAuthClient(opts: {
  clientName: string;
  redirectUris: string[];
  grantTypes?: string[];
  tokenEndpointAuthMethod?: string;
}): Promise<OAuthClient>;

/** Returns null if unknown. */
function getOAuthClient(clientId: string): Promise<OAuthClient | null>;

// --- Authorization codes ---

type OAuthCode = {
  code: string; clientId: string; redirectUri: string; codeChallenge: string;
  codeChallengeMethod: string; scope: string; resource: string | null;
  expiresAt: Date; createdAt: Date;
};

/** 5 min TTL. Returns the raw code (also the primary key — stored in plaintext, unlike tokens:
 * single-use + short-lived). */
function createAuthCode(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;               // defaults to 'silo'
  resource: string;
}): Promise<string>;

/** Fetches (if not expired) THEN DELETES — single-use. A replayed code returns null on its
 * second call. Returns null if missing or expired. */
function consumeAuthCode(code: string): Promise<OAuthCode | null>;

// --- Token issuance / refresh / verify ---

type IssuedOAuthTokens = {
  accessToken: string; refreshToken: string;
  accessExpiresIn: number;   // seconds, 3600
  refreshExpiresIn: number;  // seconds, 2592000 (30d)
  scope: string;
};

/** access_token = `oat_`+32B hex (1h TTL), refresh_token = `ort_`+32B hex (30d TTL). Stores
 * both as `access_tokens` rows (hashes only); the access row's refreshTokenHash links to its
 * paired refresh row. */
function issueOAuthTokens(opts: {
  clientId: string;
  scope?: string;        // defaults to 'silo'
  resource: string;
}): Promise<IssuedOAuthTokens>;

/** Verifies refreshToken belongs to clientId, not expired, resource matches; deletes the OLD
 * access+refresh pair; issues a FRESH pair (same shape as issueOAuthTokens). Returns null on
 * ANY verification failure (unknown hash / wrong client / expired / resource mismatch) — does
 * not distinguish which check failed. */
function rotateRefreshToken(opts: {
  refreshToken: string;
  clientId: string;
  resource: string;
}): Promise<IssuedOAuthTokens | null>;

/** THE mcp resource-server check. Requires kind='oauth_access' AND not-expired AND
 * `resource === canonicalResource` (exact string match — RFC 8707 audience check). Best-effort
 * lastUsedAt bookkeeping (never fails auth on that write failing). Use
 * `canonicalMcpResource(SILO_PUBLIC_MCP_URL)` to compute `canonicalResource`. */
function authenticateOAuthToken(rawToken: string, canonicalResource: string): Promise<boolean>;

// --- Connected-apps listing / revoke (for the settings UI) ---

type ConnectedOAuthClient = {
  clientName: string;         // display name, case as first seen (NOT lowercased)
  clientIds: string[];        // every cli_ id registered under this (lowercased) name
  grantedAt: Date;            // earliest oauth_access grant in the group
  lastUsedAt: Date | null;    // latest use across the group, or null
  activeTokenCount: number;   // non-expired oauth_access tokens across the group
  connectionCount: number;    // distinct cli_ ids in the group (>1 = re-registration noise)
};

/** Dedups by `client.name.toLowerCase()`. Sorted most-recently-granted group first. Empty
 * array if nothing is connected. */
function listOAuthClientsForOwner(): Promise<ConnectedOAuthClient[]>;

/** Deletes ALL tokens (access + refresh) for one client id. The `oauth_clients` row itself is
 * left in place (harmless stale client with no tokens) — pass EVERY id from a
 * ConnectedOAuthClient.clientIds to fully revoke a deduped group. */
function revokeOAuthClient(clientId: string): Promise<void>;

/** Deletes every OAuth token (access + refresh) across every client. Leaves kind='bearer'
 * tokens (the manual/DB-token path) untouched. */
function revokeAllOAuthClients(): Promise<void>;
```

### Key behavioral guarantees downstream can rely on

- **Audience checking is real and enforced at two points**: `createAuthCode`/`issueOAuthTokens`
  bind a `resource`; `rotateRefreshToken` and `authenticateOAuthToken` both re-check it. A token
  minted for one resource is rejected against another — `mcp`'s bearer check MUST pass its own
  `canonicalMcpResource(SILO_PUBLIC_MCP_URL)`, not trust the token blindly.
- **`consumeAuthCode` is atomic single-use** (fetch-if-valid-then-delete) — safe to call once
  per `/oauth/token` request without extra locking.
- **All raw secrets (tokens, not codes) are returned exactly once** and never retrievable again
  — only hashes persist in `access_tokens`.
- **`revokeOAuthClient`/`revokeAllOAuthClients` never touch `kind='bearer'` rows** — the existing
  manual-bearer/DB-access-token path (`tokens.ts`) is completely unaffected.
- **No `userId` parameter anywhere** — silo is single-owner; every function operates
  library-wide by design (matches the rest of `@silo/core`).

## What's NOT built yet (other units' scope)

- No HTTP routes (`@silo/api`'s `/oauth/*`, `/.well-known/oauth-authorization-server`) — Unit 2.
- No resource-server wiring (`@silo/app`'s `/mcp` bearer check, `/.well-known/oauth-protected-resource`) — Unit 3.
- No web UI (`AccessTab.tsx` connected-apps section) — Unit 4.
- No config/env threading (`SILO_PUBLIC_API_URL`, `docker-compose.prod.yml`) — Unit 5.

## Verification run (this unit)

- `pnpm --filter @silo/db check-types` — green.
- `pnpm --filter @silo/core check-types` — green.
- `pnpm --filter @silo/db test` — 20/20 passed (includes an updated golden-schema assertion in
  `migrate.test.ts` covering the new `access_tokens` columns post-migration).
- `pnpm --filter @silo/core test` — 430/430 passed (34 new in `oauth.test.ts`: PKCE pos/neg,
  canonicalMcpResource, generateOpaque, DCR register/get, single-use code consume + replay +
  expiry, token issuance, audience-mismatch rejection, expired-token rejection, refresh
  rotation + old-pair invalidation + wrong-client + resource-mismatch + replay, name-dedup
  grouping (case-insensitive, multi-id, counts/dates), revoke-one, revoke-all-preserves-bearer).
- `pnpm biome check packages/db/src packages/core/src` — clean.
