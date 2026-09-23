CREATE TABLE "epitaphs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"born_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"farewell_reflection" text NOT NULL
);
