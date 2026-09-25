ALTER TABLE "dreams" DROP CONSTRAINT "dreams_emotion_check";
--> statement-breakpoint
ALTER TABLE "dynimos" DROP CONSTRAINT "dynimos_base_emotion_check";
--> statement-breakpoint
ALTER TABLE "dynimos" DROP CONSTRAINT "dynimos_wake_mood_emotion_check";
--> statement-breakpoint
-- 'neutraal' is geen Emotie meer: kalm neemt die plek in (zoals de fallback-Basisemotie).
UPDATE "dynimos" SET "base_emotion" = 'kalm' WHERE "base_emotion" = 'neutraal';
--> statement-breakpoint
UPDATE "dynimos" SET "wake_mood_emotion" = 'kalm' WHERE "wake_mood_emotion" = 'neutraal';
--> statement-breakpoint
UPDATE "dreams" SET "emotion" = 'kalm' WHERE "emotion" = 'neutraal';
--> statement-breakpoint
UPDATE "dynimos" SET "mood_values" = "mood_values" - 'neutraal' WHERE "mood_values" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "dreams" ADD CONSTRAINT "dreams_emotion_check" CHECK ("dreams"."emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'droevig', 'vredig', 'druk'));
--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_base_emotion_check" CHECK ("dynimos"."base_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'droevig', 'vredig', 'druk'));
--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_wake_mood_emotion_check" CHECK ("dynimos"."wake_mood_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'droevig', 'vredig', 'druk'));