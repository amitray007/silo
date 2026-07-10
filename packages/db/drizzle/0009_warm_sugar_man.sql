-- access-tokens slice: drizzle-kit generated this migration with a spurious
-- `DROP TYPE "public"."link_origin"` AND `DROP TYPE "public"."capture_source"`
-- — the generated 0009 snapshot's `enums` section had dropped BOTH
-- pre-existing enum entries entirely (verified against the 0008 snapshot's
-- enums, which still has all three: capture_status, link_origin,
-- capture_source), so drizzle-kit's diff read that as "these enums were
-- removed" and emitted DROPs for types still in active use by
-- `links.added_by` (link_origin) and `links.source` (capture_source). Same
-- verified drizzle-kit gap as 0004_robust_maestro.sql and
-- 0008_blue_lilith.sql. Hand-fixed here: this table has no enum of its own
-- (token_hash/token_prefix are `text`), so the only change needed is
-- dropping the two incorrect `DROP TYPE` lines. The snapshot JSON
-- (meta/0009_snapshot.json) was likewise hand-corrected to keep all three
-- enums (matching meta/0008_snapshot.json's enums block).
CREATE TABLE "access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "access_tokens_token_hash_unique" UNIQUE("token_hash")
);