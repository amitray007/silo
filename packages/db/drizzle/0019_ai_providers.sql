CREATE TYPE "public"."ai_provider_kind" AS ENUM('anthropic', 'openai', 'gateway');--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"kind" "ai_provider_kind" PRIMARY KEY NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_last4" text NOT NULL,
	"last_test_ok" boolean,
	"last_test_at" timestamp with time zone,
	"last_test_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
