CREATE TYPE "public"."reader_source" AS ENUM('page', 'feed', 'archive');--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "reader_source" "reader_source";--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "reader_source_at" timestamp with time zone;