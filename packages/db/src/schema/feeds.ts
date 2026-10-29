import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { feedFormat, feedStatus } from './enums.js';

export const feeds = pgTable(
  'feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedUrl: text('feed_url').notNull().unique(),
    siteUrl: text('site_url'),
    title: text('title').notNull(),
    description: text('description'),
    format: feedFormat('format').notNull(),
    etag: text('etag'),
    lastModified: text('last_modified'),
    pollIntervalSeconds: integer('poll_interval_seconds').notNull().default(3600),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }).notNull(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
    status: feedStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('feeds_next_poll_at_idx').on(table.nextPollAt)],
);

export const feedEntries = pgTable(
  'feed_entries',
  {
    feedId: uuid('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    entryKey: text('entry_key').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.feedId, table.entryKey] })],
);
