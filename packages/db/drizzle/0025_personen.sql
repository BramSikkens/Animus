CREATE TABLE "persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "persons_single_owner_idx" ON "persons" USING btree ((true)) WHERE "persons"."owner";
--> statement-breakpoint
CREATE TABLE "familiarities" (
	"dynimo_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"familiarity" real NOT NULL,
	CONSTRAINT "familiarities_dynimo_id_person_id_pk" PRIMARY KEY("dynimo_id","person_id"),
	CONSTRAINT "familiarities_familiarity_range" CHECK ("familiarities"."familiarity" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "familiarities" ADD CONSTRAINT "familiarities_dynimo_id_dynimos_id_fk" FOREIGN KEY ("dynimo_id") REFERENCES "public"."dynimos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "familiarities" ADD CONSTRAINT "familiarities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "person_id" integer;
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Data-migratie (#91): één Persoon "eigenaar" krijgt alle bestaande Herinneringen en de huidige Vertrouwdheid van elke Dynimo.
insert into "persons" ("name", "owner") values ('eigenaar', true);
--> statement-breakpoint
update "memories" set "person_id" = (select "id" from "persons" where "owner") where "person_id" is null;
--> statement-breakpoint
insert into "familiarities" ("dynimo_id", "person_id", "familiarity")
select "id", (select "id" from "persons" where "owner"), "familiarity" from "dynimos";
--> statement-breakpoint
ALTER TABLE "dynimos" DROP CONSTRAINT "dynimos_familiarity_range";
--> statement-breakpoint
ALTER TABLE "dynimos" DROP COLUMN "familiarity";
