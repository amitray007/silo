import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients.js';

/**
 * A short-lived OAuth 2.1 authorization code (MCP OAuth slice, U1): created
 * by `GET/POST /oauth/authorize` on approval, consumed exactly once by
 * `POST /oauth/token`'s `authorization_code` grant. `@silo/core`'s
 * `consumeAuthCode` deletes the row on read (single-use — a replayed code
 * must fail), so surviving rows are either mid-flight (not yet exchanged) or
 * abandoned/expired; nothing purges expired rows proactively, they just fail
 * the `expires_at` check on lookup.
 */
export const oauthCodes = pgTable('oauth_codes', {
  /** Opaque code, `oac_` + random hex. */
  code: text('code').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  /** Always `'S256'` in practice — `@silo/api`'s `/oauth/authorize` rejects any other method before a code is ever created. */
  codeChallengeMethod: text('code_challenge_method').notNull(),
  scope: text('scope').notNull().default('silo'),
  /** RFC 8707 resource indicator — the canonical MCP resource URL this code (and the tokens it exchanges for) is bound to. */
  resource: text('resource'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
