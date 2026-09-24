ALTER TABLE "dreams" DROP CONSTRAINT "dreams_emotion_check";--> statement-breakpoint
ALTER TABLE "dynimos" DROP CONSTRAINT "dynimos_base_emotion_check";--> statement-breakpoint
ALTER TABLE "dynimos" DROP CONSTRAINT "dynimos_wake_mood_emotion_check";--> statement-breakpoint
ALTER TABLE "dreams" ADD CONSTRAINT "dreams_emotion_check" CHECK ("dreams"."emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal', 'droevig', 'vredig', 'druk'));--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_base_emotion_check" CHECK ("dynimos"."base_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal', 'droevig', 'vredig', 'druk'));--> statement-breakpoint
ALTER TABLE "dynimos" ADD CONSTRAINT "dynimos_wake_mood_emotion_check" CHECK ("dynimos"."wake_mood_emotion" in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal', 'droevig', 'vredig', 'druk'));