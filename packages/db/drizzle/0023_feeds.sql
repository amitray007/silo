CREATE TYPE "public"."feed_format" AS ENUM('rss', 'atom', 'rdf', 'json');--> statement-breakpoint
CREATE TYPE "public"."feed_status" AS ENUM('active', 'failing', 'gone');--> statement-breakpoint
ALTER TYPE "public"."capture_source" ADD VALUE 'feed' BEFORE 'unknown';--> statement-breakpoint
CREATE TABLE "feed_entries" (
	"feed_id" uuid NOT NULL,
	"entry_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_entries_feed_id_entry_key_pk" PRIMARY KEY("feed_id","entry_key")
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_url" text NOT NULL,
	"site_url" text,
	"title" text NOT NULL,
	"description" text,
	"format" "feed_format" NOT NULL,
	"etag" text,
	"last_modified" text,
	"poll_interval_seconds" integer DEFAULT 3600 NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"status" "feed_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feeds_feed_url_unique" UNIQUE("feed_url")
);
--> statement-breakpoint
DROP INDEX "links_canonical_url_live_unique_idx";--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "feed_id" uuid;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "saved_link_id" uuid;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feeds_next_poll_at_idx" ON "feeds" USING btree ("next_poll_at");--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_saved_link_id_links_id_fk" FOREIGN KEY ("saved_link_id") REFERENCES "public"."links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "links_canonical_url_library_unique_idx" ON "links" USING btree ("canonical_url") WHERE "links"."deleted_at" is null and "links"."feed_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "links_feed_canonical_url_live_unique_idx" ON "links" USING btree ("feed_id","canonical_url") WHERE "links"."deleted_at" is null and "links"."feed_id" is not null;--> statement-breakpoint
CREATE INDEX "links_feed_id_idx" ON "links" USING btree ("feed_id");--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_feed_fields_check" CHECK ("links"."feed_id" is not null or ("links"."archived_at" is null and "links"."saved_link_id" is null));