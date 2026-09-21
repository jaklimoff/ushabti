CREATE TABLE "task_links" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text DEFAULT 'blocks' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_links_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "done_when" jsonb;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_from_id_tasks_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_to_id_tasks_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_links_to_idx" ON "task_links" USING btree ("to_id");