ALTER TABLE "dynimos" ADD COLUMN "base_emotion" text;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "mood_emotion" text;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "mood_intensity" real;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "mood_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_base_emotion_check" CHECK ("dynimos"."base_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal'));--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_mood_emotion_check" CHECK ("dynimos"."mood_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal'));--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_mood_intensity_range" CHECK ("dynimos"."mood_intensity" between 0 and 1);--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_mood_all_or_none" CHECK (("dynimos"."mood_emotion" is null) = ("dynimos"."mood_intensity" is null) and ("dynimos"."mood_emotion" is null) = ("dynimos"."mood_at" is null));