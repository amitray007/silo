import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

/**
 * A tag a link can be labeled with. Reused across links via `link_tags`.
 *
 * `name` is the DISPLAY value — whatever casing/whitespace was entered first —
 * and is no longer unique on its own. `normalizedKey` (`lower(trim(name))`) is
 * the dedup key: case-insensitive tagging (`AI` and `ai` collapse to one row)
 * is enforced by the UNIQUE constraint on `normalized_key`, not on `name`. See
 * `packages/core/src/links/links.ts`'s `normalizeTagKey` for the single source
 * of truth that computes this key at every write site.
 */
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedKey: text('normalized_key').notNull().unique(),
});
