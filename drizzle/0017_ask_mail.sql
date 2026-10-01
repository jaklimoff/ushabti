ALTER TABLE "agent_runs" ADD COLUMN "asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "ask_mailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ask_mail" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_runs_ask_due_idx" ON "agent_runs" USING btree ("asked_at") WHERE "agent_runs"."ended_at" is null and "agent_runs"."status" = 'waiting' and "agent_runs"."ask_mailed_at" is null;