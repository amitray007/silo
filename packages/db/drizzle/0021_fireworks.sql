ALTER TYPE "public"."ai_provider_kind" ADD VALUE 'fireworks';--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "models" jsonb;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "models_fetched_at" timestamp with time zone;