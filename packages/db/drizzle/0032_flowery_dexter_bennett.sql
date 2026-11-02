CREATE TABLE "librarian_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"summary_through" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "librarian_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "librarian_messages_chat_seq_unique" UNIQUE("chat_id","seq"),
	CONSTRAINT "librarian_messages_role_check" CHECK ("librarian_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "librarian_chats" ADD CONSTRAINT "librarian_chats_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "librarian_messages" ADD CONSTRAINT "librarian_messages_chat_id_librarian_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."librarian_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "librarian_chats_link_updated_idx" ON "librarian_chats" USING btree ("link_id","updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "librarian_chats_updated_idx" ON "librarian_chats" USING btree ("updated_at" DESC NULLS LAST,"id");