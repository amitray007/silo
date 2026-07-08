import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tsvector } from '../types.js';
import { captureStatus, linkOrigin } from './enums.js';

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

    // Origin provenance (plan 007, C1): who caused this link to be saved —
    // backs the mockup's `◆` "added-by-claude" mark. `NOT NULL DEFAULT 'user'`
    // so the migration backfills every existing row to 'user' (a silent,
    // no-mark default) with no separate backfill statement needed — Postgres
    // fills the default for pre-existing rows on an `ADD COLUMN ... NOT NULL
    // DEFAULT`. See `enums.ts`'s `linkOrigin` doc comment for the merge rule.
    addedBy: linkOrigin('added_by').notNull().default('user'),

    notes: text('notes'),

    // Generated, read-only full-text column — Postgres keeps it in sync on
    // every insert/update of title/description/extracted_text/notes. MUST use
    // the explicit 'english' config: the single-arg to_tsvector(text) form is
    // not immutable and Postgres rejects it in a generated column.
    // coalesce(...) on every input column so one NULL doesn't null the whole
    // vector.
    //
    // `notes` (H2, plan 006) is weight D — the lowest — since it's a personal
    // annotation, below even the extracted body text. It CAN live in this
    // generated column because `notes` is a column of this same `links` row;
    // `tags` cannot follow the same path — a generated column can only
    // reference columns of its own row, and tags are a separate m2m table
    // (`link_tags`/`tags`) reached by a join. Tag-name matching is therefore
    // done at query time in `core`'s `search()`, not here — see that
    // function's doc comment for the query-time approach and its tradeoffs.
    //
    // Each coalesce'd input is also wrapped in `left(..., N)` — a HARD Postgres
    // limit, not a style choice: a single tsvector's serialized form must stay
    // under 1,048,576 bytes, and exceeding it is an ERROR ("string is too long
    // for tsvector") on INSERT/UPDATE, not a truncation. The enrichment clamp
    // (see `@silo/core`'s `enrichment.ts`) allows `extracted_text` up to
    // 5,000,000 chars — dense/high-lexeme text (code, base64, non-English,
    // unique tokens) around 1MB+ of source can push the generated vector past
    // the limit, which throws inside `recordEnrichment`'s UPDATE, dead-letters
    // the enrich-link job, and stranded the link at `capture_status
    // ='enriching'` — the SAME failure class the clamp fix closed, reintroduced
    // one layer down at the DB. The `left()` bounds below cap only the FTS
    // INPUT per field, never the stored value — `extracted_text` itself stays
    // unbounded for display/MCP. Worst case ~830K chars of source text across
    // all four fields keeps the serialized tsvector comfortably under the
    // 1,048,575-byte ceiling even for pathological all-unique-tokens input;
    // typical prose is far smaller, and nobody searches for a term that
    // appears only past ~½MB into one document.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', left(coalesce(${links.title}, ''), 30000)), 'A') || setweight(to_tsvector('english', left(coalesce(${links.description}, ''), 100000)), 'B') || setweight(to_tsvector('english', left(coalesce(${links.extractedText}, ''), 600000)), 'C') || setweight(to_tsvector('english', left(coalesce(${links.notes}, ''), 100000)), 'D')`,
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
