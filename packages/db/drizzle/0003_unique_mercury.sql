-- Full-text search over notes (plan 006, H2): `search_vector` is a GENERATED
-- ALWAYS AS ... STORED column, and Postgres does not support ALTERing a
-- generated column's expression in place — the only path is DROP then
-- re-ADD with the new expression. Ordering, verified against a real
-- Postgres before writing this migration:
--
--   1. DROP COLUMN "search_vector". A plain drop (no explicit CASCADE
--      keyword, no separate DROP INDEX statement) is sufficient: Postgres
--      silently drops the dependent partial GIN index
--      (links_search_vector_live_idx) along with the column it indexes.
--      There is nothing left referencing search_vector afterward.
--   2. ADD COLUMN "search_vector" back with the new expression (adds the
--      'D'-weighted notes term). Because the column is STORED, Postgres
--      recomputes and backfills it for EVERY existing row as part of this
--      ALTER — no separate UPDATE/backfill step is needed, and no row is
--      left with a stale/missing vector.
--   3. Re-CREATE the partial GIN index
--      (`... WHERE deleted_at IS NULL`) that step 1 dropped, so search
--      stays index-backed instead of falling back to a sequential scan.
--
-- Tags are intentionally NOT part of this generated expression — a
-- generated column can only reference columns of its OWN row, and tags are
-- reached via the `link_tags`/`tags` join tables. Tag-name matching happens
-- at query time in `@silo/core`'s `search()` instead (see that function's
-- doc comment).
ALTER TABLE "links" DROP COLUMN "search_vector";--> statement-breakpoint

ALTER TABLE "links" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("links"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("links"."description", '')), 'B') || setweight(to_tsvector('english', coalesce("links"."extracted_text", '')), 'C') || setweight(to_tsvector('english', coalesce("links"."notes", '')), 'D')) STORED;--> statement-breakpoint

CREATE INDEX "links_search_vector_live_idx" ON "links" USING gin ("search_vector") WHERE "links"."deleted_at" is null;
