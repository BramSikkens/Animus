ALTER TABLE "drives" DROP CONSTRAINT "drives_strength_only_aversion";--> statement-breakpoint
ALTER TABLE "drives" DROP CONSTRAINT "drives_strength_range";--> statement-breakpoint
ALTER TABLE "drives" DROP CONSTRAINT "drives_kind_check";--> statement-breakpoint
UPDATE "drives" SET "kind" = 'ergernis' WHERE "kind" = 'afkeer';--> statement-breakpoint
ALTER TABLE "drives" DROP COLUMN "strength";--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_kind_check" CHECK ("drives"."kind" in ('wens', 'doel', 'toekomstdroom', 'ergernis'));