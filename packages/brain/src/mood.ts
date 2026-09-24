// Browser-veilig: geen node-imports. Brein, agent en dashboard delen dit.
import { isEmotion, type Emotion } from "./emotion.js";

/** Halveringstijd van de intensiteit van de Stemming. */
export const MOOD_HALF_LIFE_MS = 10 * 60_000;
/** Onder deze uitgedoofde intensiteit valt de Stemming terug op de Basisemotie. */
export const MOOD_FLOOR = 0.1;
/** Intensiteit waarmee de Basisemotie zelf getoond wordt. */
export const BASE_INTENSITY = 0.3;

export type StoredMood = { emotion: Emotion; intensity: number; at: Date } | null;
export type Mood = { emotion: Emotion; intensity: number };

/** De effectieve Stemming: de opgeslagen Emotie, uitgedoofd over de tijd, of de Basisemotie. */
export function currentMood(stored: StoredMood, baseEmotion: Emotion | null, now: Date): Mood {
  if (stored) {
    // Max(0, …): een klok die terugloopt (at in de toekomst) mag de intensiteit niet boven de opgeslagen waarde tillen.
    const elapsed = Math.max(0, now.getTime() - stored.at.getTime());
    const intensity = stored.intensity * 0.5 ** (elapsed / MOOD_HALF_LIFE_MS);
    if (intensity >= MOOD_FLOOR) return { emotion: stored.emotion, intensity };
  }
  return { emotion: baseEmotion ?? "neutraal", intensity: BASE_INTENSITY };
}

/**
 * Verwerkt een nieuwe Emotie: die vervangt de Stemming enkel als haar intensiteit STRIKT hoger is dan de
 * uitgedoofde huidige (incl. het Basisniveau). Anders blijft `next` ongewijzigd (tijdstip niet verversen).
 */
export function applyEmotion(
  stored: StoredMood,
  baseEmotion: Emotion | null,
  emotion: Emotion,
  intensity: number,
  now: Date,
): { mood: Mood; next: StoredMood } {
  const current = currentMood(stored, baseEmotion, now);
  if (intensity > current.intensity) return { mood: { emotion, intensity }, next: { emotion, intensity, at: now } };
  return { mood: current, next: stored };
}

/** De mood-kolommen van een Dynimo-rij (text/real/timestamptz uit de database). */
export type MoodColumns = {
  baseEmotion: string | null;
  moodEmotion: string | null;
  moodIntensity: number | null;
  moodAt: Date | null;
};

export function baseEmotionOf(row: Pick<MoodColumns, "baseEmotion">): Emotion | null {
  return isEmotion(row.baseEmotion) ? row.baseEmotion : null;
}

export function storedMoodOf(row: MoodColumns): StoredMood {
  return isEmotion(row.moodEmotion) && row.moodIntensity !== null && row.moodAt
    ? { emotion: row.moodEmotion, intensity: row.moodIntensity, at: row.moodAt }
    : null;
}

/** De effectieve Stemming van een rij op tijdstip `now`. */
export function moodOfRow(row: MoodColumns, now: Date): Mood {
  return currentMood(storedMoodOf(row), baseEmotionOf(row), now);
}
