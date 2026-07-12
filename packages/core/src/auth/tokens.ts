import { createHash, randomBytes } from 'node:crypto';
import { accessTokens, db } from '@silo/db';
import { and, desc, eq, sql } from 'drizzle-orm';

/**
 * DB-backed named access tokens (access-tokens slice, U1): lets the user
 * mint/list/revoke multiple credentials from the web UI, verified alongside
 * the existing `SILO_API_TOKEN` env secret by the API/MCP auth gates (see
 * `docs/superpowers/specs/2026-07-11-access-tokens-design.md`). The RAW
 * token exists in plaintext ONLY at `generateAccessToken`'s return value —
 * everywhere else (DB, `listAccessTokens`) only the sha256 hash + a
 * non-secret display prefix are visible.
 */

/** Chars of the raw token shown as `tokenPrefix` — a non-secret display handle, not part of the security boundary. */
export const TOKEN_PREFIX_LEN = 12;

/** One access token as surfaced to callers that must NOT see the hash or raw value (list views, API responses). */
export type AccessTokenSummary = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/** The one-time creation result: includes the RAW token, which is never retrievable again after this call returns. */
export type CreatedAccessToken = {
  id: string;
  name: string;
  token: string;
  prefix: string;
  createdAt: Date;
};

/** Thrown when `generateAccessToken` is given a blank/whitespace-only name — a caller bug (route validation should already reject this), surfaced as a typed error rather than a generic DB constraint failure. */
export class InvalidAccessTokenNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAccessTokenNameError';
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Mints a new named access token. Generates a high-entropy raw token
 * (`'silo_' + 32 random bytes, base64url` — 256 bits of entropy, well beyond
 * what a hash-lookup timing side-channel could meaningfully exploit; see
 * `verifyAccessToken`'s doc comment), stores only its sha256 hash + a
 * `TOKEN_PREFIX_LEN`-char display prefix, and returns the RAW token to the
 * caller. This is the ONLY time the raw token exists in plaintext outside
 * the requester's own copy of it — it is never stored, logged, or
 * retrievable again.
 */
export async function generateAccessToken(name: string): Promise<CreatedAccessToken> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidAccessTokenNameError('Access token name must not be blank.');
  }

  const raw = `silo_${randomBytes(32).toString('base64url')}`;
  const tokenHash = sha256Hex(raw);
  const prefix = raw.slice(0, TOKEN_PREFIX_LEN);

  const [row] = await db
    .insert(accessTokens)
    .values({ name: trimmed, tokenHash, tokenPrefix: prefix })
    .returning({
      id: accessTokens.id,
      name: accessTokens.name,
      createdAt: accessTokens.createdAt,
    });

  if (!row) {
    // Unreachable in practice (insert...returning always yields the inserted
    // row), but satisfies noUncheckedIndexedAccess without a non-null assertion.
    throw new Error('Failed to create access token.');
  }

  return { id: row.id, name: row.name, token: raw, prefix, createdAt: row.createdAt };
}

/**
 * Every access token, WITHOUT the hash or raw value — id/name/prefix/
 * created/last-used only. Ordered newest-first (matches the web UI's list).
 */
export async function listAccessTokens(): Promise<AccessTokenSummary[]> {
  const rows = await db
    .select({
      id: accessTokens.id,
      name: accessTokens.name,
      prefix: accessTokens.tokenPrefix,
      createdAt: accessTokens.createdAt,
      lastUsedAt: accessTokens.lastUsedAt,
    })
    .from(accessTokens)
    .orderBy(desc(accessTokens.createdAt));

  return rows;
}

/** Deletes an access token by id. Returns whether a row was actually deleted (false = already gone/never existed). */
export async function revokeAccessToken(id: string): Promise<boolean> {
  const result = await db.delete(accessTokens).where(eq(accessTokens.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Verifies a presented raw bearer token against the DB. Hashes the input and
 * looks it up by `token_hash` (a unique index) — no timing-safe byte compare
 * is needed here, unlike `timingSafeEqual`'s use for the env-token check: the
 * env token is a single low-entropy operator-chosen secret where leaking
 * "how many leading bytes matched" via a naive compare is a real attack
 * surface, whereas a raw access token is 256 bits of `randomBytes` — an
 * attacker who can't already produce a hash collision gains nothing
 * actionable from a hash-lookup's timing, and the lookup itself is a DB index
 * seek, not a byte-by-byte comparison in application code.
 *
 * On a match, best-effort updates `last_used_at = now()` — wrapped in
 * try/catch so a failure to write that bookkeeping column can NEVER cause an
 * otherwise-valid credential to be rejected; the function still returns
 * `true` even if the update throws.
 *
 * Scoped to `kind='bearer'` (MCP OAuth slice, Unit 3 fix): `access_tokens`
 * is now a unified store shared with `oauth_access`/`oauth_refresh` rows
 * (`@silo/core`'s `oauth.ts`, Unit 1). Without this filter, a hash lookup
 * here would match an `oat_`/`ort_` row too — silently bypassing
 * `authenticateOAuthToken`'s expiry AND resource/audience (RFC 8707) checks
 * for any caller trying this legacy path with an OAuth token. `kind='bearer'`
 * keeps this function scoped to exactly the manual/DB-token path it always
 * was; OAuth tokens are authenticated exclusively via `authenticateOAuthToken`.
 */
export async function verifyAccessToken(rawToken: string): Promise<boolean> {
  const tokenHash = sha256Hex(rawToken);

  const [row] = await db
    .select({ id: accessTokens.id })
    .from(accessTokens)
    .where(and(eq(accessTokens.tokenHash, tokenHash), eq(accessTokens.kind, 'bearer')))
    .limit(1);

  if (!row) return false;

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
