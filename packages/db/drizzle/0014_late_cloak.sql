CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] NOT NULL,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"scope" text DEFAULT 'silo' NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "kind" text DEFAULT 'bearer' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "refresh_token_hash" text;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
-- NOTE: drizzle-kit spuriously appended `DROP TYPE "link_origin"` / `DROP TYPE
-- "capture_source"` here (the same recurring generator bug hand-fixed in
-- migrations 0004/0008/0009). Those enums are still in use by `links.added_by`
-- / source columns — dropping them would fail (dependent objects) and is not
-- intended by this OAuth migration. Removed by hand; this migration is purely
-- additive (2 new tables + 6 nullable/defaulted columns on access_tokens).