-- settings (plan 016): a minimal key -> value store (see
-- packages/db/src/schema/settings.ts's doc comment). Single-user, no user_id.
--
-- NOTE: drizzle-kit's raw generated output for this migration also included
-- a spurious `DROP TYPE "public"."link_origin";` statement — a verified
-- drizzle-kit snapshot-diffing bug (same class of gap 0002/0004's own
-- comments document: the generator's enum tracking momentarily lost
-- `link_origin` from its diff even though `links.added_by` still uses it).
-- `link_origin` remains very much in use (`links.added_by`); the wrong
-- `DROP TYPE` line was removed by hand before this migration was applied, and
-- `meta/0005_snapshot.json` was hand-corrected to keep `public.link_origin`
-- in its `enums` map so the NEXT `db:generate` diffs against the true state
-- instead of re-proposing the same bogus drop.
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
