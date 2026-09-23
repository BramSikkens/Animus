CREATE TABLE "drives" (
	"id" serial PRIMARY KEY NOT NULL,
	"dynimo_id" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"status" text,
	"strength" real,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "drives_kind_check" CHECK ("drives"."kind" in ('wens', 'doel', 'toekomstdroom', 'afkeer', 'ergernis')),
	CONSTRAINT "drives_status_check" CHECK ("drives"."status" in ('actief', 'bereikt', 'opgegeven')),
	CONSTRAINT "drives_status_only_goal" CHECK (("drives"."kind" = 'doel') = ("drives"."status" is not null)),
	CONSTRAINT "drives_strength_only_aversion" CHECK (("drives"."kind" in ('afkeer', 'ergernis')) = ("drives"."strength" is not null)),
	CONSTRAINT "drives_strength_range" CHECK ("drives"."strength" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_dynimo_id_dynimos_id_fk" FOREIGN KEY ("dynimo_id") REFERENCES "public"."dynimos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drives_dynimo_id_idx" ON "drives" USING btree ("dynimo_id");