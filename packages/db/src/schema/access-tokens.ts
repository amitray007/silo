import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
});
