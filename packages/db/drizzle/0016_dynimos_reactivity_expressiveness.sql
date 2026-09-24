ALTER TABLE "dynimos" ADD COLUMN "axis_reactivity" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "axis_expressiveness" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_axis_reactivity_range" CHECK ("dynimos"."axis_reactivity" between 0 and 1);--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_axis_expressiveness_range" CHECK ("dynimos"."axis_expressiveness" between 0 and 1);