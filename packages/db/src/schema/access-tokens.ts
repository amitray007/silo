import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients.js';

/**
 * A named DB-backed access token (access-tokens slice, U1): lets the user
 * mint/revoke multiple credentials from the web UI instead of relying on the
 * single `SILO_API_TOKEN` env secret. The RAW token is NEVER stored — only
 * `tokenHash` (sha256 hex of the raw token) persists, so a DB compromise
 * leaks hashes, not usable tokens (see `packages/core/src/auth/tokens.ts`'s
 * `generateAccessToken`/`verifyAccessToken` for the hash/verify contract).
 * `tokenPrefix` is a NON-secret display handle (first
 * `TOKEN_PREFIX_LEN` chars of the raw token, e.g. `silo_a1b2c3d4`) shown in
 * the UI so a user can recognize which token is which without ever seeing
 * the full value again after creation. `tokenHash` is UNIQUE — it is also
 * the lookup key `verifyAccessToken` hits on every authenticated request.
 *
 * MCP OAuth slice, U1: this table doubles as the unified token store for
 * OAuth access + refresh tokens (mirrors stash's `api_tokens`), rather than
 * introducing a parallel table. `kind` discriminates the row's purpose —
 * `'bearer'` (the original manual/DB-token path, unchanged), `'oauth_access'`,
 * or `'oauth_refresh'`. The five new columns are all nullable and default to
 * null/`'bearer'`: every EXISTING row lands as `kind='bearer'` with the rest
 * null, so `generateAccessToken`/`verifyAccessToken`'s behavior is unchanged
 * for the pre-existing manual-bearer path. OAuth rows are minted/read by
 * `packages/core/src/auth/oauth.ts`, never by `tokens.ts`.
 */
export const accessTokens = pgTable('access_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // null until the token's first successful auth; updated best-effort on
  // every subsequent verify (see verifyAccessToken's doc comment).
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  /** `'bearer' | 'oauth_access' | 'oauth_refresh'` — see `packages/core/src/auth/oauth.ts`. */
  kind: text('kind').notNull().default('bearer'),
  /** Set only for `oauth_access`/`oauth_refresh` rows — the client that owns this token. */
  clientId: text('client_id').references(() => oauthClients.id, { onDelete: 'cascade' }),
  /** Set only for `oauth_access`/`oauth_refresh` rows — null (never expires) for `bearer`. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Set only on the `oauth_access` row of a pair — the paired refresh token's hash, so refresh rotation can delete both sides by lookup. */
  refreshTokenHash: text('refresh_token_hash'),
  /** Set only for `oauth_access`/`oauth_refresh` rows — always `'silo'` today (see design doc's non-goals). */
  scope: text('scope'),
  /** Set only for `oauth_access`/`oauth_refresh` rows — the RFC 8707 canonical resource URL this token is bound to. */
  resource: text('resource'),
  /**
   * OAuth refresh grace window (rotateRefreshToken): set ONLY on an
   * `oauth_refresh` row that has just been rotated, and ONLY for up to 60s
   * (`GRACE_MS` in `packages/core/src/auth/oauth.ts`) afterward. Holds the
   * RAW successor access + refresh tokens (not hashes) so a retried/racing
   * refresh request presenting this SAME old refresh token within the grace
   * window can be handed back the identical successor pair (idempotent
   * replay) instead of failing with `invalid_grant` — the fix for connectors
   * reading a retried refresh as "connection expired". This is a deliberate,
   * narrow exception to the table's "hashes only" posture: the raw values
   * exist in plaintext here for at most `GRACE_MS`, for a single
   * already-in-flight successor pair the client already holds in plaintext
   * itself. Both columns are cleared back to null the moment the grace
   * window is exceeded (checked, never proactively swept) or once the
   * successor itself completes its own rotation. Null for every other row
   * (`bearer`, `oauth_access`, and any `oauth_refresh` row outside its grace
   * window).
   */
  successorAccessToken: text('successor_access_token'),
  /** Paired with `successorAccessToken` — see its doc comment for the 60s time-box. */
  successorRefreshToken: text('successor_refresh_token'),
});
