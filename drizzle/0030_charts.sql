CREATE TABLE "charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"position" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charts_user_idx" ON "charts" USING btree ("user_id");--> statement-breakpoint
-- A value line named a select's option by name only. Each older line takes the
-- id of the option that carries that name today, once; a chart counts by id.
-- A line whose property is gone, or whose name matches nothing, keeps none.
UPDATE "activity" AS a
SET "data" = a."data" || jsonb_build_object('optionId', o."id"::text)
FROM "properties" AS p, "property_options" AS o
WHERE a."kind" = 'value'
	AND NOT (a."data" ? 'optionId')
	AND p."id"::text = a."data"->>'propertyId'
	AND p."type" IN ('select', 'iteration')
	AND o."property_id" = p."id"
	AND o."name" = a."data"->>'value';
