ALTER TABLE "feeds" ADD COLUMN "media_backfill_done" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "feeds" ALTER COLUMN "media_backfill_done" SET DEFAULT true;
