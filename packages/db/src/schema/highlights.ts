import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { links } from './links.js';

/** The five semantic highlight colours. The check constraint below uses this list. */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'violet'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/**
 * A passage the owner (or an agent) highlighted in a link's article, with an
 * optional note. Anchoring follows the W3C Web Annotation model: the quote with
 * its prefix and suffix is the truth, and the offsets are hints into the
 * article's normalised text. Rows are independent ranges, so highlights may
 * overlap. The cascade purges them with the link; trash and restore keep them.
 */
export const highlights = pgTable(
  'highlights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    quote: text('quote').notNull(),
    prefix: text('prefix').notNull().default(''),
    suffix: text('suffix').notNull().default(''),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    color: text('color').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('highlights_link_id_idx').on(table.linkId),
    check(
      'highlights_color_check',
      sql`${table.color} in (${sql.raw(HIGHLIGHT_COLORS.map((c) => `'${c}'`).join(', '))})`,
    ),
    check('highlights_quote_length_check', sql`char_length(${table.quote}) between 1 and 5000`),
    check(
      'highlights_context_length_check',
      sql`char_length(${table.prefix}) <= 64 and char_length(${table.suffix}) <= 64`,
    ),
    check(
      'highlights_note_length_check',
      sql`${table.note} is null or char_length(${table.note}) <= 10000`,
    ),
  ],
);
