import { createHash, randomBytes } from 'node:crypto';
import { accessTokens, db, oauthClients, oauthCodes } from '@silo/db';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';

/**
 * MCP OAuth core logic (MCP OAuth slice, U1): OAuth 2.1 + PKCE (S256) +
 * Dynamic Client Registration (RFC 7591) + resource indicators (RFC 8707),
 * framework-free — ported from the reference implementation at
 * `/Users/maverick/code/projects/stash`'s `lib/auth/oauth.ts`, adapted to
 * silo's single-owner posture (no `userId` scoping — silo has exactly one
 * owner) and its unified `access_tokens` table (silo extends the existing
 * table with `kind`/`clientId`/`expiresAt`/... instead of a parallel
 * `api_tokens` table — see `packages/db/src/schema/access-tokens.ts`'s doc
 * comment). See `docs/superpowers/specs/2026-07-12-mcp-oauth-design.md` for
 * the full design and `docs/superpowers/specs/OAUTH-INTERFACES.md` for the
 * exact contract downstream builders (api/mcp/web) build against.
 *
 * Only `@silo/core` may import `@silo/db` (docs/rules/architecture.md) — all
 * OAuth persistence goes through this module.
 */

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** The single scope silo issues today (see design doc's non-goals — no per-scope permissions). */
const OAUTH_SCOPE = 'silo';

/** Generates a random opaque token/id: `prefix` + `bytes` random bytes as hex. Raw value returned once by callers — never stored. */
export function generateOpaque(prefix: string, bytes = 32): string {
  return prefix + randomBytes(bytes).toString('hex');
}

/** SHA-256 hex digest — the only form of a token/code ever persisted. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Verifies a PKCE `code_verifier` against a stored `code_challenge`. Only
 * `S256` is supported (per the MCP authorization spec's requirement) — any
 * other method, including `plain`, is rejected outright.
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return computed === challenge;
}

/**
 * Normalizes a configured public MCP URL into the canonical RFC 8707
 * resource string both the api (authorization server) and mcp (resource
 * server) containers must agree on bit-for-bit: no trailing slash, ending in
 * `/mcp`. Single source of truth — both containers call this on the same
 * `SILO_PUBLIC_MCP_URL` env value (see design doc's "cross-origin agreement
 * seams").
 */
export function canonicalMcpResource(publicMcpUrl: string): string {
  const trimmed = publicMcpUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}

/** A registered OAuth client, as returned by `registerOAuthClient`/`getOAuthClient`. */
export type OAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  createdAt: Date;
};

/**
 * Registers a new public OAuth client (RFC 7591 dynamic registration).
 * Public clients only — callers (the `@silo/api` DCR route) are responsible
 * for rejecting any `tokenEndpointAuthMethod` other than `'none'` before
 * calling this; this function does not itself validate the auth method.
 */
export async function registerOAuthClient(opts: {
  clientName: string;
  redirectUris: string[];
  grantTypes?: string[];
  tokenEndpointAuthMethod?: string;
}): Promise<OAuthClient> {
  const id = generateOpaque('cli_', 24);
  const grantTypes = opts.grantTypes ?? ['authorization_code', 'refresh_token'];
  const tokenEndpointAuthMethod = opts.tokenEndpointAuthMethod ?? 'none';

  const [row] = await db
    .insert(oauthClients)
    .values({
      id,
      name: opts.clientName,
      redirectUris: opts.redirectUris,
      grantTypes,
      tokenEndpointAuthMethod,
    })
    .returning();

  if (!row) {
    // Unreachable in practice (insert...returning always yields the inserted
    // row), but satisfies noUncheckedIndexedAccess without a non-null assertion.
    throw new Error('Failed to register OAuth client.');
  }

  return row;
}

/** Looks up a registered OAuth client by id. Returns `null` if unknown. */
export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  return row ?? null;
}

/** A stored, not-yet-consumed authorization code row. */
export type OAuthCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * Stores a short-lived (5 min) authorization code after the owner approves
 * consent. Returns the raw code — the ONLY time it exists outside the DB
 * (stored in plaintext here, unlike tokens, since it's single-use and
 * short-lived; mirrors stash's `oauth_codes` design).
 */
export async function createAuthCode(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  resource: string;
}): Promise<string> {
  const code = generateOpaque('oac_', 24);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db.insert(oauthCodes).values({
    code,
    clientId: opts.clientId,
    redirectUri: opts.redirectUri,
    codeChallenge: opts.codeChallenge,
    codeChallengeMethod: opts.codeChallengeMethod,
    scope: opts.scope ?? OAUTH_SCOPE,
    resource: opts.resource,
    expiresAt,
  });

  return code;
}

/**
 * Consumes an authorization code: fetches it if non-expired, then deletes it
 * (single-use — a replayed code fails on its second lookup because the row
 * is already gone). Returns `null` if the code is missing or expired.
 */
export async function consumeAuthCode(code: string): Promise<OAuthCode | null> {
  const now = new Date();

  const [row] = await db
    .select()
    .from(oauthCodes)
    .where(and(eq(oauthCodes.code, code), gt(oauthCodes.expiresAt, now)))
    .limit(1);

  if (!row) return null;

  await db.delete(oauthCodes).where(eq(oauthCodes.code, code));

  return row;
}

/** A freshly-issued OAuth access + refresh token pair. Raw values — never persisted, returned once. */
export type IssuedOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
  scope: string;
};

/**
 * Issues an OAuth access token (`oat_`, 1h TTL) + refresh token (`ort_`, 30d
 * TTL) pair and stores both as `access_tokens` rows (hashes only). The
 * access row's `refreshTokenHash` links it to its paired refresh row so
 * `rotateRefreshToken` can delete both sides of a pair by one lookup.
 */
export async function issueOAuthTokens(opts: {
  clientId: string;
  scope?: string;
  resource: string;
}): Promise<IssuedOAuthTokens> {
  const scope = opts.scope ?? OAUTH_SCOPE;
  const accessToken = generateOpaque('oat_', 32);
  const refreshToken = generateOpaque('ort_', 32);

  const accessHash = hashToken(accessToken);
  const refreshHash = hashToken(refreshToken);

  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);

  const label = `oauth:${opts.clientId}`;

  await db.insert(accessTokens).values({
    name: label,
    tokenHash: accessHash,
    tokenPrefix: accessToken.slice(0, 12),
    kind: 'oauth_access',
    clientId: opts.clientId,
    expiresAt: accessExpiresAt,
    refreshTokenHash: refreshHash,
    scope,
    resource: opts.resource,
  });

  await db.insert(accessTokens).values({
    name: label,
    tokenHash: refreshHash,
    tokenPrefix: refreshToken.slice(0, 12),
    kind: 'oauth_refresh',
    clientId: opts.clientId,
    expiresAt: refreshExpiresAt,
    scope,
    resource: opts.resource,
  });

  return {
    accessToken,
    refreshToken,
    accessExpiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    refreshExpiresIn: Math.floor(REFRESH_TTL_MS / 1000),
    scope,
  };
}

/**
 * Rotates a refresh token: verifies it belongs to `clientId`, is not
 * expired, and matches the bound `resource`; deletes the old access+refresh
 * pair; issues a fresh pair. A stolen/reused old refresh token cannot be
 * replayed — its row is gone the moment rotation succeeds. Returns `null` on
 * any verification failure (unknown hash, wrong client, expired, resource
 * mismatch) without leaking which check failed.
 */
export async function rotateRefreshToken(opts: {
  refreshToken: string;
  clientId: string;
  resource: string;
}): Promise<IssuedOAuthTokens | null> {
  const now = new Date();
  const refreshHash = hashToken(opts.refreshToken);

  const [refreshRow] = await db
    .select()
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.tokenHash, refreshHash),
        eq(accessTokens.kind, 'oauth_refresh'),
        eq(accessTokens.clientId, opts.clientId),
        gt(accessTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!refreshRow) return null;
  if ((refreshRow.resource ?? null) !== opts.resource) return null;

  // Delete the paired access token (looked up by the refresh row's own hash,
  // since the ACCESS row is the one carrying `refreshTokenHash`) and the
  // refresh row itself.
  await db
    .delete(accessTokens)
    .where(
      and(eq(accessTokens.refreshTokenHash, refreshHash), eq(accessTokens.kind, 'oauth_access')),
    );
  await db.delete(accessTokens).where(eq(accessTokens.id, refreshRow.id));

  return issueOAuthTokens({
    clientId: opts.clientId,
    scope: refreshRow.scope ?? OAUTH_SCOPE,
    resource: opts.resource,
  });
}

/**
 * Authenticates a raw OAuth access token (`oat_…`) against the canonical MCP
 * resource it must be bound to (RFC 8707 audience check). Requires
 * `kind='oauth_access'` AND not-expired AND `resource` matches exactly — a
 * token minted for a different resource is rejected here, not just at
 * mint-time. On a match, best-effort updates `lastUsedAt` (never fails auth
 * if that write fails — mirrors `verifyAccessToken`'s posture in
 * `tokens.ts`).
 */
export async function authenticateOAuthToken(
  rawToken: string,
  canonicalResource: string,
): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select({ id: accessTokens.id, resource: accessTokens.resource })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.tokenHash, tokenHash),
        eq(accessTokens.kind, 'oauth_access'),
        gt(accessTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return false;
  if (row.resource !== canonicalResource) return false;

  try {
    await db
      .update(accessTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(accessTokens.id, row.id));
  } catch {
    // Best-effort bookkeeping only — a failure here must never fail auth.
  }

  return true;
}

/** One deduped "connected app" row for the settings UI — see `listOAuthClientsForOwner`'s doc comment. */
export type ConnectedOAuthClient = {
  /** The client's display name (case as first seen), NOT lowercased. */
  clientName: string;
  /** Every `cli_…` id registered under this (lowercased) name. */
  clientIds: string[];
  /** Earliest `oauth_access` token grant among the group. */
  grantedAt: Date;
  /** Latest `lastUsedAt` among the group's tokens, or `null` if none have been used. */
  lastUsedAt: Date | null;
  /** Count of non-expired `oauth_access` tokens across the group. */
  activeTokenCount: number;
  /** Number of distinct `cli_…` ids in the group (>1 means re-registration noise — see design doc). */
  connectionCount: number;
};

/** One raw `oauth_access` row joined to its client, as read by `listOAuthClientsForOwner`. */
type OwnerOAuthTokenRow = {
  clientId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  clientName: string;
};

/**
 * Folds one token row into its name-keyed group, creating the group on
 * first sight. Extracted from `listOAuthClientsForOwner` to keep that
 * function's cognitive complexity under Biome's ceiling (see
 * docs/rules/typescript.md) — the merge rules themselves (earliest grant,
 * latest use, active-token tally, distinct-id count) live here.
 */
function mergeOAuthClientRow(
  groups: Map<string, ConnectedOAuthClient>,
  row: OwnerOAuthTokenRow,
  now: Date,
): void {
  if (!row.clientId) return;
  const key = row.clientName.toLowerCase();
  const isActive = row.expiresAt !== null && row.expiresAt > now;

  const existing = groups.get(key);
  if (!existing) {
    groups.set(key, {
      clientName: row.clientName,
      clientIds: [row.clientId],
      grantedAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      activeTokenCount: isActive ? 1 : 0,
      connectionCount: 1,
    });
    return;
  }

  if (!existing.clientIds.includes(row.clientId)) {
    existing.clientIds.push(row.clientId);
    existing.connectionCount += 1;
  }
  if (row.createdAt < existing.grantedAt) existing.grantedAt = row.createdAt;
  if (row.lastUsedAt && (!existing.lastUsedAt || row.lastUsedAt > existing.lastUsedAt)) {
    existing.lastUsedAt = row.lastUsedAt;
  }
  if (isActive) existing.activeTokenCount += 1;
}

/**
 * Lists every connected OAuth app, deduped by lowercased client name —
 * Claude/ChatGPT re-run DCR on every connect, minting a fresh `cli_…` id
 * each time, so without dedup the settings UI would show dozens of rows for
 * what a human sees as one app. Grouped by `client.name.toLowerCase()`;
 * within a group: `clientIds` collects every id, `grantedAt` is the
 * earliest grant, `lastUsedAt` is the latest use, `activeTokenCount` counts
 * non-expired access tokens. Sorted most-recently-granted group first.
 */
export async function listOAuthClientsForOwner(): Promise<ConnectedOAuthClient[]> {
  const now = new Date();

  const rows = await db
    .select({
      clientId: accessTokens.clientId,
      createdAt: accessTokens.createdAt,
      lastUsedAt: accessTokens.lastUsedAt,
      expiresAt: accessTokens.expiresAt,
      clientName: oauthClients.name,
    })
    .from(accessTokens)
    .innerJoin(oauthClients, eq(accessTokens.clientId, oauthClients.id))
    .where(eq(accessTokens.kind, 'oauth_access'))
    .orderBy(desc(accessTokens.createdAt));

  const groups = new Map<string, ConnectedOAuthClient>();
  for (const row of rows) {
    mergeOAuthClientRow(groups, row, now);
  }

  return [...groups.values()].sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
}

/** Revokes every token (access + refresh) issued to one OAuth client. The `oauth_clients` row itself is left in place — a harmless stale client with no tokens (see design doc's revoke semantics). */
export async function revokeOAuthClient(clientId: string): Promise<void> {
  await db.delete(accessTokens).where(eq(accessTokens.clientId, clientId));
}

/** Revokes every OAuth token (access + refresh) across every connected client — leaves manual `kind='bearer'` tokens untouched. */
export async function revokeAllOAuthClients(): Promise<void> {
  await db
    .delete(accessTokens)
    .where(
      and(
        isNotNull(accessTokens.clientId),
        inArray(accessTokens.kind, ['oauth_access', 'oauth_refresh']),
      ),
    );
}
