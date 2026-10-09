ALTER TABLE "project_members" ADD COLUMN "position" text;--> statement-breakpoint
-- Each person keeps the order they saw before: the order the projects were
-- made in. A fixed width keeps the digits sorting as numbers, and the closing
-- V keeps the rule of `src/lib/rank.ts` that a rank never ends in its lowest
-- digit, with room above the first one for a project joined later.
UPDATE "project_members" AS m SET "position" = r."rank"
FROM (
  SELECT pm."project_id", pm."user_id",
    'V' || lpad((row_number() OVER (
      PARTITION BY pm."user_id" ORDER BY p."created_at", p."id"
    ))::text, 6, '0') || 'V' AS "rank"
  FROM "project_members" pm
  JOIN "projects" p ON p."id" = pm."project_id"
) AS r
WHERE m."project_id" = r."project_id" AND m."user_id" = r."user_id";--> statement-breakpoint
ALTER TABLE "project_members" ALTER COLUMN "position" SET NOT NULL;
