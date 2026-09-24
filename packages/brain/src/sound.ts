// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
import type { Emotion } from "./emotion.js";
import type { Mood } from "./mood.js";

export const SOUND_KINDS = ["kirren", "zuchten", "brommen"] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

export function isSoundKind(value: unknown): value is SoundKind {
  return typeof value === "string" && (SOUND_KINDS as readonly string[]).includes(value);
}

/** Bericht op het LiveKit data channel, van agent naar gezichtje. */
export type SoundMessage = { kind: SoundKind };
export const SOUND_TOPIC = "sound";

/** Een andere Emotie telt pas als zichtbare verandering vanaf deze intensiteit. */
export const VISIBLE_EMOTION_MIN_INTENSITY = 0.4;
/** Dezelfde Emotie telt als zichtbaar veranderd bij minstens dit intensiteitsverschil. */
export const VISIBLE_INTENSITY_DELTA = 0.3;

/** Is de Stemming zichtbaar veranderd (genoeg om een geluidje te rechtvaardigen)? */
export function isVisibleMoodChange(before: Mood, after: Mood): boolean {
  if (before.emotion !== after.emotion) return after.intensity >= VISIBLE_EMOTION_MIN_INTENSITY;
  return Math.abs(after.intensity - before.intensity) >= VISIBLE_INTENSITY_DELTA;
}

/** Triggersoort bij een nieuwe Stemming-emotie; neutraal maakt geen geluid. */
export function soundKindFor(emotion: Emotion): SoundKind | null {
  switch (emotion) {
    case "blij":
    case "nieuwsgierig":
    case "verrast":
      return "kirren";
    case "boos":
      return "brommen";
    case "bang":
    case "verveeld":
    case "kalm":
      return "zuchten";
    case "neutraal":
      return null;
  }
}
