-- Case-insensitive tags (plan 004, W1): `tags.name` stays the display value
-- (whatever casing was entered first); `tags.normalized_key` (`lower(trim(name))`)
-- becomes the dedup key. Hand-augmented beyond what `drizzle-kit generate` produced
-- (a plain `ADD COLUMN ... NOT NULL UNIQUE` would fail if any pre-existing tags
-- already collide under normalization, e.g. both "AI" and "ai" rows). Ordered so
-- the table is never in a state that could reject a valid backfill or lose data:
--
--   1. add normalized_key NULLABLE (no constraint yet)
--   2. backfill normalized_key = lower(trim(name)) for every existing row
--   3. merge collisions: for each normalized_key shared by >1 row, keep the
--      row with the lexicographically-smallest id (`min(id::text)` — postgres
--      has no `min(uuid)` aggregate; any deterministic, total tie-break works
--      since which duplicate becomes canonical doesn't matter, only that it's
--      consistent) as the survivor; repoint the dupes' link_tags rows to the
--      survivor (ON CONFLICT DO NOTHING — a link may already hold the
--      survivor tag, which would otherwise violate the (link_id,tag_id) PK);
--      delete the now-orphaned dupe tag rows (link_tags rows for them are gone
--      by then, so no FK violation either).
--   4. NOT NULL + UNIQUE on normalized_key; DROP the old UNIQUE on name.
--
-- No rows are lost: every link that held a dupe tag keeps the survivor tag
-- (via the repoint) or already held it (the ON CONFLICT DO NOTHING no-op).
--
-- Edge note: any pre-existing tag whose name is empty/whitespace-only
-- normalizes to '' and would be merged into a single "blank" tag here. The app
-- never creates such tags (addTagWith drops empty names), so this is only
-- reachable via legacy/manual data — audit with
-- `select count(*) from tags where trim(name) = ''` before running on a DB
-- that might contain them. The merge handles them correctly either way (they
-- collapse to one row, no data loss); the audit is just to know it happened.

-- 1. Add nullable, unconstrained.
ALTER TABLE "tags" ADD COLUMN "normalized_key" text;--> statement-breakpoint

-- 2. Backfill.
UPDATE "tags" SET "normalized_key" = lower(trim("name"));--> statement-breakpoint

-- 3. Merge collisions: repoint link_tags from each dupe to its survivor
-- (min id per normalized_key), then delete the dupes.
WITH survivors AS (
  SELECT "normalized_key", min("id"::text)::uuid AS survivor_id
  FROM "tags"
  GROUP BY "normalized_key"
),
dupes AS (
  SELECT "t"."id" AS dupe_id, "s"."survivor_id"
  FROM "tags" "t"
  JOIN "survivors" "s" ON "s"."normalized_key" = "t"."normalized_key"
  WHERE "t"."id" <> "s"."survivor_id"
)
INSERT INTO "link_tags" ("link_id", "tag_id")
SELECT "lt"."link_id", "d"."survivor_id"
FROM "link_tags" "lt"
JOIN "dupes" "d" ON "d"."dupe_id" = "lt"."tag_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint

WITH survivors AS (
  SELECT "normalized_key", min("id"::text)::uuid AS survivor_id
  FROM "tags"
  GROUP BY "normalized_key"
),
dupes AS (
  SELECT "t"."id" AS dupe_id
  FROM "tags" "t"
  JOIN "survivors" "s" ON "s"."normalized_key" = "t"."normalized_key"
  WHERE "t"."id" <> "s"."survivor_id"
)
DELETE FROM "link_tags"
WHERE "tag_id" IN (SELECT "dupe_id" FROM "dupes");--> statement-breakpoint

WITH survivors AS (
  SELECT "normalized_key", min("id"::text)::uuid AS survivor_id
  FROM "tags"
  GROUP BY "normalized_key"
)
DELETE FROM "tags" "t"
USING "survivors" "s"
WHERE "t"."normalized_key" = "s"."normalized_key"
  AND "t"."id" <> "s"."survivor_id";--> statement-breakpoint

-- 4. Lock it down: NOT NULL + UNIQUE on the new key, drop the old unique on name.
ALTER TABLE "tags" ALTER COLUMN "normalized_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_normalized_key_unique" UNIQUE("normalized_key");--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_name_unique";
