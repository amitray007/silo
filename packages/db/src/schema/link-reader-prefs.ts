import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { links } from './links.js';

/** Partial presentation choices. Writes do not change the link's content timestamp. */
export const linkReaderPrefs = pgTable('link_reader_prefs', {
  linkId: uuid('link_id')
    .primaryKey()
    .references(() => links.id, { onDelete: 'cascade' }),
  prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
