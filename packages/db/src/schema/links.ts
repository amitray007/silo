import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tsvector } from '../types.js';
import { captureStatus } from './enums.js';

/**
 * The `links` table — one row per saved item. Stable typed columns for
 * fields every source shares; source-specific fields live in `source_data`.
 *
 * TODO(U3): `source_data` is loosely typed here as `unknown`. U3 adds a
 * per-source Zod discriminated union (keyed on `source_kind`) and a real
 * inferred `SourceData` type for `.$type<SourceData>()`. Runtime validation
 * of `source_data` happens at the `core` write boundary, not here — this
 * column's compile-time type is a placeholder until then.
 */
export const links = pgTable(
  'links',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Raw + canonical URL (see docs plan R5/R7): canonicalization is a `core`
    // (U3) concern. `canonicalUrl` falls back to the raw url when
    // canonicalization fails, so it is never null.
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),

    title: text('title'),
    description: text('description'),
    imageUrl: text('image_url'),
    siteName: text('site_name'),
    extractedText: text('extracted_text'),

    sourceKind: text('source_kind').notNull(),
    // Deliberately typed as the loose storage shape, NOT `SourceData`.
    // `SourceData` (the per-source Zod union) lives in `@silo/core`; typing this
    // column with it would make `@silo/db` import `@silo/core`, inverting the
    // core→db dependency the architecture enforces (and tripping no-circular).
    // `db` is a leaf: it stores JSON; `core` validates `source_data` against the
    // Zod union at the write boundary and casts reads to `SourceData`.
    sourceData: jsonb('source_data').$type<Record<string, unknown>>(),

    captureStatus: captureStatus('capture_status').notNull().default('enriching'),

    notes: text('notes'),

    // Generated, read-only full-text column — Postgres keeps it in sync on
    // every insert/update of title/description/extracted_text. MUST use the
    // explicit 'english' config: the single-arg to_tsvector(text) form is not
    // immutable and Postgres rejects it in a generated column. coalesce(...)
    // on every input column so one NULL doesn't null the whole vector.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${links.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${links.description}, '')), 'B') || setweight(to_tsvector('english', coalesce(${links.extractedText}, '')), 'C')`,
    ),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // `$onUpdate` makes drizzle set updated_at on every ORM update — a plain
    // DEFAULT now() only fires on INSERT, so edits/enrichment would otherwise
    // leave updated_at frozen at creation time. All writes go through `core`,
    // so ORM-level coverage is sufficient.
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // null = live; set = soft-deleted (trash). See docs/rules and plan R9.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Dedup (plan R6): unique only among live rows, so a trashed/purged URL
    // frees the slot for a fresh save. A plain unique would forbid ever
    // re-saving a URL sitting in trash.
    uniqueIndex('links_canonical_url_live_unique_idx')
      .on(table.canonicalUrl)
      .where(sql`${table.deletedAt} is null`),
    // Full-text search index (plan R11/R12): partial, live rows only —
    // trashed rows never need to be searched.
    index('links_search_vector_live_idx')
      .using('gin', table.searchVector)
      .where(sql`${table.deletedAt} is null`),
    index('links_source_kind_idx').on(table.sourceKind),
    // Supports U4's `list` filtered by capture_status among live rows.
    index('links_capture_status_live_idx')
      .on(table.captureStatus)
      .where(sql`${table.deletedAt} is null`),
  ],
);
