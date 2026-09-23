ALTER TABLE "drives" ADD COLUMN "dropped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "last_reflected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "wake_mood_emotion" text;--> statement-breakpoint
ALTER TABLE "dynimos" ADD COLUMN "wake_mood_intensity" real;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "impression" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_wake_mood_emotion_check" CHECK ("dynimos"."wake_mood_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal'));--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_wake_mood_intensity_range" CHECK ("dynimos"."wake_mood_intensity" between 0 and 1);--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_wake_mood_all_or_none" CHECK (("dynimos"."wake_mood_emotion" is null) = ("dynimos"."wake_mood_intensity" is null));--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_impression_range" CHECK ("memories"."impression" between 0 and 1);