-- source-data NULL fix (search-url method follow-up): `source_data` was the
-- ONE legacy column that shipped nullable with no default and no backfill —
-- unlike `added_by`/`source`/`enrich_attempts` (see `links.ts`'s doc
-- comments), which all got `NOT NULL DEFAULT ...` from day one and so
-- backfilled themselves via Postgres's "fill the default for every existing
-- row" behavior on a plain `ADD COLUMN`. `source_data` instead landed as a
-- bare nullable `jsonb` column, so legacy rows sit at `source_data = NULL`.
-- `core`'s strict `sourceDataSchema` (a discriminated union, see
-- `@silo/core`'s `links/source-data.ts`) rejects `null`, so every NULL row
-- fails validation on read; `@silo/api`'s `shapeSourceData` (`link-json.ts`)
-- floors it to `{kind:'link'}` — harmless, but logs a validation warning per
-- NULL row on every list/search. `{"kind":"link"}` is exactly that same
-- link-floor shape, so this migration makes the DB enforce the invariant the
-- read path was already silently applying.
--
-- Because `source_data` is an EXISTING nullable column (not a brand-new one),
-- Postgres's "ADD COLUMN ... NOT NULL DEFAULT backfills existing rows for
-- free" trick does not apply here — that only fires when the column itself
-- is being added. Ordered so the table is never in a state that could reject
-- a valid row or lose data:
--
--   1. Backfill every existing NULL row to '{"kind":"link"}' FIRST — this
--      statement was hand-added; `drizzle-kit generate` does not know to
--      backfill before tightening a constraint, it only diffs schema shape.
--      Skipping this step would make step 3 (`SET NOT NULL`) fail outright
--      on any pre-existing NULL row.
--   2. Set the column DEFAULT to '{"kind":"link"}'::jsonb, so future inserts
--      that omit `source_data` get the link floor instead of NULL.
--   3. Set the column NOT NULL, now safe since no row is NULL anymore.
--
-- NOTE: drizzle-kit's raw generated output for this migration also included
-- two spurious `DROP TYPE "public"."link_origin";` and
-- `DROP TYPE "public"."capture_source";` statements — the SAME verified
-- drizzle-kit snapshot-diffing bug 0006/0007/0009/0012's comments document
-- (the generator's enum tracking momentarily dropped both enums from its
-- diff even though `links.added_by` (link_origin) and `links.source`
-- (capture_source) still use them). Both spurious lines were removed by
-- hand; `meta/0013_snapshot.json` was hand-corrected to restore the full
-- `enums` map (matching 0012's: `capture_status`, `link_origin`,
-- `capture_source`) so the NEXT `db:generate` diffs against the true state
-- instead of re-proposing the same bogus drops.

-- 1. Backfill legacy NULL rows to the link floor.
UPDATE "links" SET "source_data" = '{"kind":"link"}'::jsonb WHERE "source_data" IS NULL;--> statement-breakpoint

-- 2. Default future inserts that omit source_data to the same floor.
ALTER TABLE "links" ALTER COLUMN "source_data" SET DEFAULT '{"kind":"link"}'::jsonb;--> statement-breakpoint

-- 3. Now safe: no row is NULL anymore.
ALTER TABLE "links" ALTER COLUMN "source_data" SET NOT NULL;
