CREATE TYPE "public"."reader_access" AS ENUM('paywalled', 'blocked');--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "reader_access" "reader_access";