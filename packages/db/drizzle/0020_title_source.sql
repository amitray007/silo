CREATE TYPE "public"."title_source" AS ENUM('page', 'ai', 'user');--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "title_source" "title_source" DEFAULT 'page' NOT NULL;--> statement-breakpoint
-- Backfill: an existing twitter title that is not a page title was probably edited by the owner, so mark it 'user'.
-- Page titles from x.com end in " on X" or " / X" (for example "Name (@handle) on X"), or read "Name on X: "post text"".
UPDATE "links" SET "title_source" = 'user'
WHERE "source_kind" = 'twitter'
  AND "title" IS NOT NULL
  AND "title" !~ ' on X$'
  AND "title" !~ ' / X$'
  AND "title" !~ ' on X: ';
