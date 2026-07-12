import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../types.js';
import { captureSource, captureStatus, linkOrigin } from './enums.js';

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

    // Capture-source provenance (capture-source slice): the SURFACE this link
    // was captured through (web/mcp/cli/raycast/chrome/ingest), orthogonal to
    // `addedBy` above. `NOT NULL DEFAULT 'unknown'` backfills every existing
    // row with no separate backfill statement. See `enums.ts`'s
    // `captureSource` doc comment for the first-write-sticky merge rule.
    source: captureSource('source').notNull().default('unknown'),

    // Enrichment lifecycle (plan 025): counts recorded enrichment attempts.
    // `recordEnrichment` increments this on every attempt; `requestRetry`
    // resets it to 0 (a fresh start). `findStrandedEnriching` excludes rows
    // at ENRICH_ATTEMPT_CAP so a persistently-failing link stops being
    // re-kicked forever — it settles instead (see `@silo/core`'s
    // `settleGiveUp`). `NOT NULL DEFAULT 0` backfills every existing row.
    enrichAttempts: integer('enrich_attempts').notNull().default(0),

    notes: text('notes'),

    // Generated, read-only full-text column — Postgres keeps it in sync on
    // every insert/update of title/description/extracted_text/notes/
    // canonical_url. MUST use the explicit 'english' config: the single-arg
    // to_tsvector(text) form is not immutable and Postgres rejects it in a
    // generated column. coalesce(...) on every input column so one NULL
    // doesn't null the whole vector.
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
    // `canonical_url` (search-url method) is ALSO indexed at weight C —
    // the same tier as `extracted_text`, a real but secondary signal, below
    // title (A) and description (B). Only `canonical_url` is indexed, never
    // the raw `url`: `canonical_url` is NOT NULL (never null, always falls
    // back to the raw url on canonicalization failure — see the column's own
    // comment) and dedup-normalized, so indexing it alone avoids
    // double-indexing near-identical raw+canonical strings.
    //
    // Before tokenizing, the URL is passed through `split_part(..., '#', 1)`
    // to drop everything from the first `#` onward. This strips ordinary URL
    // fragments AND — critically — the internal `#unsafe-<uuid>` dedup
    // marker `core`'s `createLink` appends to `canonicalUrl` for `ok:false`
    // URLs (see `@silo/core`'s `links.ts`, `storedCanonicalUrl`). Without
    // this, that marker's `unsafe` stem and UUID hex chunks would become
    // real, searchable lexemes — `search('unsafe')` would match every
    // unsafe-flagged link, which is an internal implementation detail
    // leaking into user-facing search, not a real signal.
    //
    // The `english` tsvector config treats a whole URL as one opaque
    // host/path token, so typing part of a domain or path (e.g. `github`)
    // would never match — we pre-split it by replacing every run of
    // non-alphanumeric characters with a space via
    // `regexp_replace(..., '[^[:alnum:]]+', ' ', 'g')` BEFORE handing it to
    // to_tsvector, so each domain/path segment becomes its own lexeme. This
    // uses Postgres's POSIX unicode-aware `[:alnum:]` character class (NOT
    // the ASCII-only `a-zA-Z0-9`), so non-ASCII/IDN domains and paths (e.g.
    // `bücher`, CJK path segments) are split and tokenized correctly instead
    // of being shattered mid-word or left unsearchable. ASCII behavior is
    // unchanged: plain ASCII words still split exactly the same way.
    // Consequence accepted: digit-joined segments are NOT sub-split by this
    // regex, so a path segment like `amitray007` stays one token — searching
    // `amitray` alone will NOT match a stored `amitray007` (only the exact
    // joined token, or a longer prefix via websearch's own tokenizing, would).
    // This is a deliberate, documented tradeoff, not a bug.
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
    // unbounded for display/MCP. `canonical_url` is clamped to 4,000 bytes —
    // URLs are short, so this is ample headroom, not a realistic truncation
    // path. Worst case ~830K chars of source text across the title/
    // description/extracted_text/notes fields plus ~4K of URL keeps the
    // serialized tsvector comfortably under the 1,048,575-byte ceiling even
    // for pathological all-unique-tokens input; typical prose is far smaller,
    // and nobody searches for a term that appears only past ~½MB into one
    // document.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', left(coalesce(${links.title}, ''), 30000)), 'A') || setweight(to_tsvector('english', left(coalesce(${links.description}, ''), 100000)), 'B') || setweight(to_tsvector('english', left(coalesce(${links.extractedText}, ''), 600000)), 'C') || setweight(to_tsvector('english', regexp_replace(left(split_part(coalesce(${links.canonicalUrl}, ''), '#', 1), 4000), '[^[:alnum:]]+', ' ', 'g')), 'C') || setweight(to_tsvector('english', left(coalesce(${links.notes}, ''), 100000)), 'D')`,
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
    // Trigram substring-search index (search-substring method, D1): a `pg_trgm`
    // GIN expression index over the SAME field set `search_vector` covers
    // (minus `extracted_text`, per the frozen method decision — see
    // `packages/core/src/links/search-query.ts`'s `buildSubstringMatch` doc
    // comment for why extracted_text is excluded from the trigram tier),
    // partial `WHERE deleted_at IS NULL` mirroring `links_search_vector_live_idx`
    // above. Backs `core`'s trigram-fallback `ILIKE '%needle%'` tier (fires
    // only when the prefix-FTS tier above returns zero rows). Concatenation
    // order/expression MUST stay byte-identical to `buildSubstringMatch`'s
    // SQL, or the planner won't recognize the ILIKE predicate as index-backed.
    index('links_trgm_live_idx')
      .using(
        'gin',
        sql`(coalesce(${table.title}, '') || ' ' || coalesce(${table.description}, '') || ' ' || regexp_replace(left(split_part(coalesce(${table.canonicalUrl}, ''), '#', 1), 4000), '[^[:alnum:]]+', ' ', 'g') || ' ' || coalesce(${table.notes}, '')) gin_trgm_ops`,
      )
      .where(sql`${table.deletedAt} is null`),
  ],
);
