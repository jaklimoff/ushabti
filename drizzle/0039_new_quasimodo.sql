DROP INDEX "activity_project_idx";--> statement-breakpoint
DROP INDEX "agent_run_log_run_idx";--> statement-breakpoint
DROP INDEX "tasks_project_position_idx";--> statement-breakpoint
DROP INDEX "tasks_project_live_idx";--> statement-breakpoint
CREATE INDEX "tasks_project_position_idx" ON "tasks" USING btree ("project_id","position" collate "C","number");--> statement-breakpoint
CREATE INDEX "tasks_project_live_idx" ON "tasks" USING btree ("project_id","position" collate "C","number") WHERE "tasks"."archived_at" is null and "tasks"."deleted_at" is null;