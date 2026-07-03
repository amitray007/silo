CREATE TYPE "public"."capture_status" AS ENUM('enriching', 'full', 'partial', 'bare');--> statement-breakpoint
CREATE TABLE "link_tags" (
	"link_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "link_tags_link_id_tag_id_pk" PRIMARY KEY("link_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"description" text,
	"image_url" text,
	"site_name" text,
	"extracted_text" text,
	"source_kind" text NOT NULL,
	"source_data" jsonb,
	"capture_status" "capture_status" DEFAULT 'enriching' NOT NULL,
	"notes" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("links"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("links"."description", '')), 'B') || setweight(to_tsvector('english', coalesce("links"."extracted_text", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "link_tags" ADD CONSTRAINT "link_tags_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_tags" ADD CONSTRAINT "link_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_tags_tag_id_idx" ON "link_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_canonical_url_live_unique_idx" ON "links" USING btree ("canonical_url") WHERE "links"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "links_search_vector_live_idx" ON "links" USING gin ("search_vector") WHERE "links"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "links_source_kind_idx" ON "links" USING btree ("source_kind");--> statement-breakpoint
CREATE INDEX "links_capture_status_live_idx" ON "links" USING btree ("capture_status") WHERE "links"."deleted_at" is null;