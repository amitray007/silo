import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { links } from './links.js';

export const librarianChats = pgTable(
  'librarian_chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id').references(() => links.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    summary: text('summary'),
    summaryThrough: integer('summary_through').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('librarian_chats_link_updated_idx').on(t.linkId, t.updatedAt.desc(), t.id),
    index('librarian_chats_updated_idx').on(t.updatedAt.desc(), t.id),
  ],
);

export const librarianMessages = pgTable(
  'librarian_messages',
  {
    id: text('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => librarianChats.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    parts: jsonb('parts').$type<unknown[]>().notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('librarian_messages_chat_seq_unique').on(t.chatId, t.seq),
    check('librarian_messages_role_check', sql`${t.role} in ('user', 'assistant')`),
  ],
);
