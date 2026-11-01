import { pgTable, real, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { links } from './links.js';

/**
 * Where the reader stopped in a link's article: a share (0 to 1) of its words.
 * A separate table keeps frequent position writes from bumping
 * `links.updated_at`. The cascade purges it with the link; trash and restore
 * keep it because the link row survives.
 */
export const readingPositions = pgTable('reading_positions', {
  linkId: uuid('link_id')
    .primaryKey()
    .references(() => links.id, { onDelete: 'cascade' }),
  position: real('position').notNull(),
  source: varchar('source', { enum: ['pencil', 'listen', 'mark'] })
    .notNull()
    .default('pencil'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
