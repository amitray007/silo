import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A minimal key -> value settings store (plan 016). Single-user/localhost
 * scope (see `docs/rules/api-hono.md`'s "Auth (there is none)" section) —
 * there is no `user_id` column because there is only one user. `key` is the
 * primary key (one row per known setting, e.g. `'theme'`, `'trashPurgeDays'`,
 * `'plugins'`); `value` is `jsonb` since different keys hold different
 * shapes (a string, a number, a record) — `@silo/core`'s `settings` module
 * owns the per-key Zod validation of what's allowed to live in this column,
 * mirroring `links.sourceData`'s "db stores JSON, core validates" split (see
 * `links.ts`'s `sourceData` column doc comment).
 *
 * `updatedAt` is informational only (no reader depends on it today) — kept
 * for the same reason `links.updatedAt` is: cheap to have, useful for a
 * future "last changed" affordance without a migration.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
