CREATE TABLE "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"color" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "highlights_color_check" CHECK ("highlights"."color" in ('yellow', 'green', 'blue', 'pink', 'violet')),
	CONSTRAINT "highlights_quote_length_check" CHECK (char_length("highlights"."quote") between 1 and 5000),
	CONSTRAINT "highlights_context_length_check" CHECK (char_length("highlights"."prefix") <= 64 and char_length("highlights"."suffix") <= 64),
	CONSTRAINT "highlights_note_length_check" CHECK ("highlights"."note" is null or char_length("highlights"."note") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "highlights_link_id_idx" ON "highlights" USING btree ("link_id");