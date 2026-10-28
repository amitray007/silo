import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { aiProviderKind } from './enums.js';

/**
 * One row per AI provider kind (AI foundation): the owner's API key for that
 * provider, ENCRYPTED. `encryptedKey` holds `v1.<kid>.<iv>.<tag>.<ciphertext>`
 * (AES-256-GCM, see `@silo/core`'s `ai/secret-box.ts`); the plaintext key never
 * touches this table. `keyLast4` is the only part of the key kept for display.
 * `lastTest*` record the outcome of the most recent connection test; the code
 * comes from a fixed list in core, never from a provider's error text.
 * Each feature chooses its provider in the `ai` setting.
 */
export const aiProviders = pgTable('ai_providers', {
  kind: aiProviderKind('kind').primaryKey(),
  encryptedKey: text('encrypted_key').notNull(),
  keyLast4: text('key_last4').notNull(),
  lastTestOk: boolean('last_test_ok'),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestCode: text('last_test_code'),
  models: jsonb('models').$type<{ id: string; label: string; contextLength: number | null }[]>(),
  modelsFetchedAt: timestamp('models_fetched_at', { withTimezone: true }),
  modelsRefreshError: text('models_refresh_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
