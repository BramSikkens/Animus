CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "identity" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"core_character" text NOT NULL,
	"evolved_character" text DEFAULT '' NOT NULL,
	"birth_story" text NOT NULL,
	"seed" text NOT NULL,
	"born_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_singleton" CHECK ("identity"."id" = 1)
);
