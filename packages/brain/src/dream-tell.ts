// Browser-veilig, puur. Kiest een recente, nog niet verteld Droom die de Dynimo spontaan mag vertellen (CONTEXT.md: Droom).
import { EMOTIONS, type Emotion } from "./emotion.js";
import type { DisplayState } from "./display.js";
import type { MoodValues } from "./mood.js";

/** Alleen Dromen jonger dan dit. */
export const DREAM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Basiskans bij een initiatief-moment. */
export const DREAM_TELL_CHANCE = 0.3;
/** Kans-factor per dominante Emotie; niet genoemd = 1. */
const MOOD_FACTOR: Partial<Record<Emotion, number>> = { verveeld: 2, kalm: 2, vredig: 2, boos: 0.3, druk: 0.3 };

export type TellableDream = { id: number; createdAt: Date; toldAt: Date | null; emotion: string; intensity: number };

function dominant(values: MoodValues): Emotion {
  return EMOTIONS.reduce((best, e) => (values[e] > values[best] ? e : best), EMOTIONS[0]);
}

/** De te vertellen Droom (de nieuwste ongeziene), of null. Eén rng-worp = de kans. */
export function pickDreamToTell<T extends TellableDream>({ dreams, values, displayState, rng, now }: { dreams: T[]; values: MoodValues; displayState: DisplayState; rng: () => number; now: Date }): T | null {
  if (displayState === "luisterend" || displayState === "spreekt") return null;
  const fresh = dreams.filter((d) => !d.toldAt && now.getTime() - d.createdAt.getTime() < DREAM_MAX_AGE_MS);
  if (fresh.length === 0 || rng() >= DREAM_TELL_CHANCE * (MOOD_FACTOR[dominant(values)] ?? 1)) return null;
  return fresh.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}
