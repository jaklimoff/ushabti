ALTER TABLE "project_invites" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "project_invites" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "project_invites_hash_key" ON "project_invites" USING btree ("hash");