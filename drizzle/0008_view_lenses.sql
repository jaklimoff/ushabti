CREATE TABLE "view_lenses" (
	"user_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	"filters" jsonb DEFAULT '{"rules":[]}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_lenses_user_id_view_id_pk" PRIMARY KEY("user_id","view_id")
);
--> statement-breakpoint
ALTER TABLE "view_lenses" ADD CONSTRAINT "view_lenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_lenses" ADD CONSTRAINT "view_lenses_view_id_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "view_lenses_view_idx" ON "view_lenses" USING btree ("view_id");