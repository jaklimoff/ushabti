ALTER TABLE "projects" ADD COLUMN "color" text;--> statement-breakpoint
-- Every project there is gets the colour a new one with its key would get:
-- `pickProjectColor` in `src/lib/colors.ts`, the same sum over the key's code
-- points and the same list, copied here. `project-color.test.ts` runs this
-- statement against that function.
UPDATE "projects" AS p SET "color" = (ARRAY[
  '#f08a7e', '#f0a860', '#e3c55a', '#b5cf66', '#7cc48a',
  '#5cc5b0', '#63c3dc', '#7aa8f0', '#a99af0', '#ec8fb8'
])[1 + mod(coalesce((
  SELECT sum(ascii(substr(p."key", i, 1))::numeric * power(31::numeric, length(p."key") - i))
  FROM generate_series(1, length(p."key")) AS i
), 0), 10)::int];--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "color" SET DEFAULT '#f08a7e';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "color" SET NOT NULL;
