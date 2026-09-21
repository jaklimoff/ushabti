DROP INDEX "tasks_project_live_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_project_deleted_idx" ON "tasks" USING btree ("project_id","deleted_at" desc) WHERE "tasks"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_project_live_idx" ON "tasks" USING btree ("project_id","position") WHERE "tasks"."archived_at" is null and "tasks"."deleted_at" is null;