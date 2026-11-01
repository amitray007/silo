ALTER TABLE "reading_positions" ADD COLUMN "source" varchar DEFAULT 'pencil' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_source_check" CHECK ("reading_positions"."source" in ('pencil', 'listen', 'mark'));
