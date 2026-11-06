import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { links } from './links.js';

export const pageSnapshots = pgTable('page_snapshots', {
  linkId: uuid('link_id')
    .primaryKey()
    .references(() => links.id, { onDelete: 'cascade' }),
  html: text('html').notNull(),
  url: text('url').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
