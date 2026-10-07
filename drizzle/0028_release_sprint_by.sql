ALTER TABLE "projects" ADD COLUMN "release_by" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sprint_by" text;--> statement-breakpoint
-- A project that already dated a select uses releases, and one that already
-- had an iteration uses sprints: the first of each, in the Settings order.
UPDATE "projects" SET "release_by" = (
  SELECT "id"::text FROM "properties"
  WHERE "properties"."project_id" = "projects"."id"
    AND "type" = 'select'
    AND "config"->>'dated' = 'true'
  ORDER BY "position" COLLATE "C" ASC
  LIMIT 1
);--> statement-breakpoint
UPDATE "projects" SET "sprint_by" = (
  SELECT "id"::text FROM "properties"
  WHERE "properties"."project_id" = "projects"."id"
    AND "type" = 'iteration'
  ORDER BY "position" COLLATE "C" ASC
  LIMIT 1
);
