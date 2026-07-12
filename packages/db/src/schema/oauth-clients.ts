import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A dynamically-registered OAuth client (MCP OAuth slice, U1): one row per
 * RFC 7591 `POST /oauth/register` call. Public clients only (PKCE, no
 * secret) — `tokenEndpointAuthMethod` is always `'none'` (enforced by the
 * `@silo/api` DCR route, not here). Claude/ChatGPT re-register on every
 * connect, so this table accumulates many rows per human-recognizable app;
 * `@silo/core`'s `listOAuthClientsForOwner` dedups by lowercased `name` for
 * display — this table stores the raw, undeduped registrations.
 */
export const oauthClients = pgTable('oauth_clients', {
  /** Opaque client id, `cli_` + random hex — see `generateOpaque` in `packages/core/src/auth/oauth.ts`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
