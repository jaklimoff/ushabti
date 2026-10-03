ALTER TABLE "comments" ADD COLUMN "by_project" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "property_options" ADD COLUMN "rolled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "property_options" ADD COLUMN "kept_open" boolean DEFAULT false NOT NULL;