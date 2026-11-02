CREATE INDEX "highlights_created_at_id_idx" ON "highlights" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "links_saved_link_id_idx" ON "links" USING btree ("saved_link_id");--> statement-breakpoint
CREATE INDEX "links_library_order_idx" ON "links" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "links"."deleted_at" is null and "links"."feed_id" is null;--> statement-breakpoint
CREATE INDEX "links_canonical_url_library_idx" ON "links" USING btree ("canonical_url") WHERE "links"."feed_id" is null;--> statement-breakpoint
CREATE INDEX "links_trash_order_idx" ON "links" USING btree ("deleted_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "links"."deleted_at" is not null and "links"."feed_id" is null;--> statement-breakpoint
-- Drizzle has no INCLUDE API. The schema/snapshot track the keys and predicate;
-- archived_at is payload only. Keep this clause in SQL if this index is rebuilt.
CREATE INDEX "links_feed_order_idx" ON "links" USING btree ("feed_id",coalesce("published_at", "created_at") desc,"id" DESC NULLS FIRST) INCLUDE ("archived_at") WHERE "links"."deleted_at" is null and "links"."feed_id" is not null;--> statement-breakpoint
CREATE INDEX "links_library_counts_idx" ON "links" USING btree ("deleted_at") WHERE "links"."feed_id" is null;--> statement-breakpoint
CREATE INDEX "reading_positions_updated_at_link_id_idx" ON "reading_positions" USING btree ("updated_at" DESC NULLS FIRST,"link_id" DESC NULLS FIRST);
