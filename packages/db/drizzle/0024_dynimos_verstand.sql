ALTER TABLE "dynimos" ADD COLUMN "verstand" real;--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_verstand_range" CHECK ("dynimos"."verstand" between 0 and 1);