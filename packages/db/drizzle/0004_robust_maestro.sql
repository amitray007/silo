-- link_origin (plan 007, C1): backs the `◆` "added-by-claude" mark. drizzle-kit
-- generated this migration WITHOUT the `CREATE TYPE` statement for the new
-- enum (a verified drizzle-kit gap — the generated snapshot omitted
-- `link_origin` from its `enums` section even though the schema declares it,
-- so the raw generated SQL would fail on a fresh database with
-- `type "link_origin" does not exist`; confirmed by applying the raw output
-- against a disposable DB before hand-fixing). Hand-added here, mirroring
-- 0001_mature_madame_hydra.sql's `CREATE TYPE` for `capture_status`.
--
-- The subsequent `ADD COLUMN ... NOT NULL DEFAULT 'user'` needs no separate
-- backfill step: Postgres computes and fills the default for every
-- PRE-EXISTING row as part of the same ALTER (there is no window where an
-- existing row is NOT NULL-violating), so every row written before this
-- migration lands on `added_by = 'user'` automatically — verified against a
-- disposable DB with pre-existing rows (see migrate.test.ts's C1 case).
CREATE TYPE "public"."link_origin" AS ENUM('user', 'agent');--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "added_by" "link_origin" DEFAULT 'user' NOT NULL;