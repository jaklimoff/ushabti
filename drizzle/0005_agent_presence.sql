ALTER TABLE "agent_tokens" ADD COLUMN "listening_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "activity_project_time_idx" ON "activity" USING btree ("project_id","created_at");