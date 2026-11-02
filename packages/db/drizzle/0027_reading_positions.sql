CREATE TABLE "reading_positions" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"position" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;