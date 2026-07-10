-- capture_source (capture-source slice): drizzle-kit generated this migration
-- WITHOUT the `CREATE TYPE` statement for the new enum, AND with a spurious
-- `DROP TYPE "public"."link_origin"` — the generated 0008 snapshot's `enums`
-- section had dropped the pre-existing `link_origin` entry entirely (verified
-- against the 0007 snapshot's enums, which still has it), so drizzle-kit's
-- diff read that as "link_origin was removed" and emitted a DROP for a type
-- still in active use by `links.added_by`. Same verified drizzle-kit gap as
-- 0004_robust_maestro.sql's `link_origin` CREATE TYPE omission. Hand-fixed
-- here: add the missing `CREATE TYPE` for `capture_source`, and drop the
-- incorrect `DROP TYPE "public"."link_origin"` line — the snapshot JSON
-- (meta/0008_snapshot.json) was likewise hand-corrected to keep both enums.
--
-- The subsequent `ADD COLUMN ... NOT NULL DEFAULT 'unknown'` needs no
-- separate backfill step: Postgres computes and fills the default for every
-- pre-existing row as part of the same ALTER (same pattern as 0004's
-- `added_by` backfill — see migrate.test.ts's C1 case for the proof pattern
-- this migration's own test mirrors).
CREATE TYPE "public"."capture_source" AS ENUM('web', 'mcp', 'cli', 'raycast', 'chrome', 'ingest', 'unknown');--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "source" "capture_source" DEFAULT 'unknown' NOT NULL;