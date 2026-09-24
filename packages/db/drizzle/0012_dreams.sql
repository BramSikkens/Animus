CREATE TABLE "dreams" (
	"id" serial PRIMARY KEY NOT NULL,
	"dynimo_id" integer NOT NULL,
	"text" text NOT NULL,
	"emotion" text NOT NULL,
	"intensity" real NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dreams_emotion_check" CHECK ("dreams"."emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal')),
	CONSTRAINT "dreams_intensity_range" CHECK ("dreams"."intensity" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "dreams" ADD CONSTRAINT "dreams_dynimo_id_dynimos_id_fk" FOREIGN KEY ("dynimo_id") REFERENCES "public"."dynimos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dreams_dynimo_id_idx" ON "dreams" USING btree ("dynimo_id");