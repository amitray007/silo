ALTER TABLE "links" ADD COLUMN "enrich_fields" text[];--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "enrich_request_seq" integer DEFAULT 0 NOT NULL;