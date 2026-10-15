CREATE TABLE "chart_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"position" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charts" DROP CONSTRAINT "charts_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "chart_sources" ADD CONSTRAINT "chart_sources_chart_id_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_sources" ADD CONSTRAINT "chart_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chart_sources_chart_idx" ON "chart_sources" USING btree ("chart_id");--> statement-breakpoint
-- Every chart made before now becomes a chart of one source, the one it named.
INSERT INTO "chart_sources" ("chart_id", "project_id", "property_id", "option_id", "position")
SELECT "id", "project_id", "property_id", "option_id", "position" FROM "charts";--> statement-breakpoint
ALTER TABLE "charts" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "charts" DROP COLUMN "property_id";--> statement-breakpoint
ALTER TABLE "charts" DROP COLUMN "option_id";