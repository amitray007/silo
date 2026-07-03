import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

/** A tag a link can be labeled with. Reused across links via `link_tags`. */
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});
