ALTER TYPE "public"."reader_source" ADD VALUE 'extension';--> statement-breakpoint
CREATE TABLE "page_snapshots" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"html" text NOT NULL,
	"url" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;