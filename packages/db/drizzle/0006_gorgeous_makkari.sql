-- Bound FTS input (this fix): Postgres has a HARD limit — a single
-- tsvector's serialized form must stay under 1,048,576 bytes, and exceeding
-- it is an ERROR ("string is too long for tsvector") on INSERT/UPDATE, not a
-- truncation. The enrichment clamp (see `@silo/core`'s `enrichment.ts`) allows
-- `extracted_text` up to 5,000,000 chars — dense/high-lexeme text (code,
-- base64, non-English, unique tokens) around 1MB+ of source can push the
-- generated vector past the limit, throwing inside `recordEnrichment`'s
-- UPDATE, dead-lettering the enrich-link job, and stranding the link at
-- `capture_status='enriching'` — the SAME failure class the clamp fix closed,
-- reintroduced one layer down at the DB. Each coalesce'd input is now wrapped
-- in `left(..., N)`, bounding only the FTS INPUT per field — the stored
-- `extracted_text` value itself stays unbounded for display/MCP.
--
-- Postgres does not support ALTERing a generated column's expression in
-- place — the only path is DROP then re-ADD with the new expression, same
-- ordering as 0003_unique_mercury (which added the `notes` weight to this
-- same column), verified against a real Postgres:
--
--   1. DROP COLUMN "search_vector". A plain drop (no explicit CASCADE
--      keyword, no separate DROP INDEX statement) is sufficient: Postgres
--      silently drops the dependent partial GIN index
--      (links_search_vector_live_idx) along with the column it indexes.
--      There is nothing left referencing search_vector afterward.
--   2. ADD COLUMN "search_vector" back with the new, bounded expression.
--      Because the column is STORED, Postgres recomputes and backfills it
--      for EVERY existing row as part of this ALTER — no separate
--      UPDATE/backfill step is needed, and no row is left with a
--      stale/missing vector.
--   3. Re-CREATE the partial GIN index
--      (`... WHERE deleted_at IS NULL`) that step 1 dropped, so search
--      stays index-backed instead of falling back to a sequential scan.
--
-- NOTE: drizzle-kit's raw generated output for this migration was wrong on
-- two counts, hand-corrected before this file was applied: (1) it omitted
-- the re-CREATE INDEX statement entirely — it doesn't model that dropping a
-- column silently drops indexes depending on it, same gap 0003's own comment
-- documents; (2) it emitted a spurious `DROP TYPE "public"."link_origin";` —
-- the same verified drizzle-kit snapshot-diffing bug 0005's comment
-- documents (the generator's enum tracking momentarily lost `link_origin`
-- from its diff even though `links.added_by` still uses it). Both lines were
-- removed by hand; `meta/0006_snapshot.json` was hand-corrected to keep
-- `public.link_origin` in its `enums` map so the NEXT `db:generate` diffs
-- against the true state instead of re-proposing the same bogus drop.
ALTER TABLE "links" DROP COLUMN "search_vector";--> statement-breakpoint

ALTER TABLE "links" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', left(coalesce("links"."title", ''), 30000)), 'A') || setweight(to_tsvector('english', left(coalesce("links"."description", ''), 100000)), 'B') || setweight(to_tsvector('english', left(coalesce("links"."extracted_text", ''), 600000)), 'C') || setweight(to_tsvector('english', left(coalesce("links"."notes", ''), 100000)), 'D')) STORED;--> statement-breakpoint

CREATE INDEX "links_search_vector_live_idx" ON "links" USING gin ("search_vector") WHERE "links"."deleted_at" is null;
