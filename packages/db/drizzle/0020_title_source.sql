CREATE TYPE "public"."title_source" AS ENUM('page', 'ai', 'user');--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "title_source" "title_source" DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "enrich_floor_status" "capture_status";--> statement-breakpoint
-- Backfill (user edits always win): a title that is not the page's own probably came from the owner, so mark it 'user'.
-- The page title is not stored anywhere else, so the rule is a shape test.
--   - A title equal to the url is the give-up fallback (settleGiveUp), not an edit: it stays 'page'.
--   - A twitter title is a page title when it ends in " on X" or " / X", or reads "Name on X: "post text"".
--   - Any other title that differs from the url is treated as possibly edited.
UPDATE "links" SET "title_source" = 'user'
WHERE "title" IS NOT NULL
  AND "title" <> "url"
  AND (
    "source_kind" <> 'twitter'
    OR (
      "title" !~ ' on X$'
      AND "title" !~ ' / X$'
      AND "title" !~ ' on X: '
    )
  );
