CREATE TABLE "personal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "via_token_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "via_token_id" uuid;--> statement-breakpoint
ALTER TABLE "personal_tokens" ADD CONSTRAINT "personal_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_tokens_hash_key" ON "personal_tokens" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "personal_tokens_user_idx" ON "personal_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_via_token_id_personal_tokens_id_fk" FOREIGN KEY ("via_token_id") REFERENCES "public"."personal_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_via_token_id_personal_tokens_id_fk" FOREIGN KEY ("via_token_id") REFERENCES "public"."personal_tokens"("id") ON DELETE set null ON UPDATE no action;