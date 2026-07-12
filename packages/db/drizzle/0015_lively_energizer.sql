-- Hand-fixed (same drizzle-kit snapshot bug documented in 0008_blue_lilith.sql
-- and covered by migrate.test.ts's "capture_status/link_origin/capture_source
-- survive" regression test): drizzle-kit's generated diff again silently
-- dropped `link_origin`/`capture_source` from the snapshot's `enums` section
-- and emitted spurious `DROP TYPE` statements for both, even though this
-- migration only adds two nullable columns to `access_tokens` and touches
-- neither enum. The two `DROP TYPE` lines below have been removed; the
-- `meta/0015_snapshot.json` `enums` section was restored to match 0014's so
-- future `db:generate` runs diff against the correct baseline instead of
-- reintroducing the same spurious drop.
ALTER TABLE "access_tokens" ADD COLUMN "successor_access_token" text;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD COLUMN "successor_refresh_token" text;