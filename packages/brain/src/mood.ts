// Browser-veilig: geen node-imports. Brein, agent en dashboard delen dit.
import { EMOTIONS, EMOTION_PAIRS, isEmotion, oppositeOf, type Emotion } from "./emotion.js";

/** Halveringstijd waarmee elke emotiewaarde naar haar ruststand uitdooft. */
export const MOOD_HALF_LIFE_MS = 3 * 60_000;
/** Ruststand (0–100) van elke emotie, behalve de Basisemotie (zie BASE_LEVEL). */
export const REST_LEVEL = 50;
/** Ruststand (0–100) van de Basisemotie; de rest rust op REST_LEVEL (via reconcilePairs zakt een tegenpool naar 100 - dit). */
export const BASE_LEVEL = 65;
/** Basisemotie als die ontbreekt (nog niet gebackfilld). */
export const FALLBACK_BASE: Emotion = "kalm";

/**
 * Reactiviteit (0–1, 0.5 = neutraal) → factor 0.05..1.95 (0.5 geeft 1; 0 = nauwelijks bewegen). Schaalt zowel de Type1-delta's als de
 * halveringstijd: een reactieve Dynimo beweegt sterker én dooft langzamer uit, een nuchtere het omgekeerde.
 */
export const reactivityFactor = (reactivity: number) => 0.05 + 1.9 * reactivity;
/** Het bereik boven de rust is 50 i.p.v. 100 (ADR-0017); deze schaal herstelt de sterkte die de Type1-delta's vóór de ruststand van 50 hadden. */
export const DELTA_SCALE = 0.5;
/** De halveringstijd wordt begrensd: bij r≈0 dooft de Stemming niet absurd snel uit. */
const halfLifeFactor = (reactivity: number) => Math.min(2.5, Math.max(0.25, reactivityFactor(reactivity)));

/** Elke emotie uit EMOTIONS heeft altijd een waarde 0–100. */
export type MoodValues = Record<Emotion, number>;
export type StoredMood = { values: MoodValues; at: Date } | null;
/** De Stemming: de volledige vector, plus de zichtbare (hoogste) emotie en haar waarde als 0–1. */
export type Mood = { emotion: Emotion; intensity: number; values: MoodValues };

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Hoe ver `value` boven de ruststand (REST_LEVEL) staat, als 0..1. De enige sterktemaat (ADR-0017). */
export const strength = (value: number): number => clamp01((value - REST_LEVEL) / (100 - REST_LEVEL));

/** Trek van een positieve delta op de tegenpool, als fractie van die delta (blij +30 -> droevig -15). */
export const PAIR_PULL = 0.5;

/**
 * Houdt de paren consistent (ADR-0015): van een paar is de kleinste nooit hoger dan 100 minus de grootste, dus twee hoge
 * waarden tegelijk kunnen niet. Idempotent, zodat opgeslagen en uitgedoofde waarden dezelfde regel delen.
 */
function reconcilePairs(values: MoodValues): MoodValues {
  const out = { ...values };
  for (const [a, b] of EMOTION_PAIRS) {
    const [low, high] = out[a] <= out[b] ? [a, b] : [b, a];
    out[low] = Math.min(out[low], 100 - out[high]);
  }
  return out;
}

function restValues(base: Emotion): MoodValues {
  const raw = Object.fromEntries(EMOTIONS.map((emotion) => [emotion, emotion === base ? BASE_LEVEL : REST_LEVEL])) as MoodValues;
  return reconcilePairs(raw);
}

/** De hoogste emotie; bij een gelijkstand de Basisemotie, anders de eerste in EMOTIONS. */
function dominantOf(values: MoodValues, base: Emotion): Emotion {
  let best: Emotion = EMOTIONS[0];
  for (const emotion of EMOTIONS) {
    if (values[emotion] > values[best] || (values[emotion] === values[best] && emotion === base && best !== base)) best = emotion;
  }
  return best;
}

function moodOf(values: MoodValues, base: Emotion): Mood {
  const emotion = dominantOf(values, base);
  return { emotion, intensity: strength(values[emotion]), values };
}

/** De effectieve Stemming: de opgeslagen waarden, per emotie exponentieel uitgedoofd naar de ruststand. */
export function currentMood(stored: StoredMood, baseEmotion: Emotion | null, now: Date, reactivity = 0.5): Mood {
  const base = baseEmotion ?? FALLBACK_BASE;
  const rest = restValues(base);
  if (!stored) return moodOf(rest, base);
  // Max(0, …): een klok die terugloopt (at in de toekomst) mag de waarden niet boven de opgeslagen waarde tillen.
  const decay = 0.5 ** (Math.max(0, now.getTime() - stored.at.getTime()) / (MOOD_HALF_LIFE_MS * halfLifeFactor(reactivity)));
  const values = Object.fromEntries(
    EMOTIONS.map((emotion) => [emotion, rest[emotion] + (stored.values[emotion] - rest[emotion]) * decay]),
  ) as MoodValues;
  return moodOf(reconcilePairs(values), base);
}

export type MoodDeltas = Partial<Record<Emotion, number>>;

/**
 * Verwerkt de Type1-delta's van één uiting: opgeteld bij de uitgedoofde waarden en geclampt op 0–100. Zonder
 * enige delta blijft `next` ongewijzigd (tijdstip niet verversen).
 */
export function applyDeltas(
  stored: StoredMood,
  baseEmotion: Emotion | null,
  deltas: MoodDeltas,
  now: Date,
  reactivity = 0.5,
): { mood: Mood; next: StoredMood } {
  const current = currentMood(stored, baseEmotion, now, reactivity);
  const scale = reactivityFactor(reactivity) * DELTA_SCALE;
  if (EMOTIONS.every((emotion) => !deltas[emotion])) return { mood: current, next: stored };
  // Een positieve delta trekt de tegenpool PAIR_PULL van die delta de andere kant op.
  const values = reconcilePairs(
    Object.fromEntries(
      EMOTIONS.map((emotion) => {
        const opposite = oppositeOf(emotion);
        const pull = opposite ? Math.max(0, deltas[opposite] ?? 0) * PAIR_PULL : 0;
        return [emotion, clamp(current.values[emotion] + ((deltas[emotion] ?? 0) - pull) * scale)];
      }),
    ) as MoodValues,
  );
  return { mood: moodOf(values, baseEmotion ?? FALLBACK_BASE), next: { values, at: now } };
}

/** De mood-kolommen van een Dynimo-rij (text/jsonb/timestamptz uit de database). */
export type MoodColumns = {
  baseEmotion: string | null;
  moodValues: unknown;
  moodAt: Date | null;
  axisReactivity?: number;
};

export function baseEmotionOf(row: Pick<MoodColumns, "baseEmotion">): Emotion | null {
  return isEmotion(row.baseEmotion) ? row.baseEmotion : null;
}

/** Ontbrekende of ongeldige emoties tellen als in rust (REST_LEVEL); waarden worden geclampt. */
export function storedMoodOf(row: Pick<MoodColumns, "moodValues" | "moodAt">): StoredMood {
  const raw = row.moodValues;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !row.moodAt) return null;
  const record = raw as Record<string, unknown>;
  const values = Object.fromEntries(
    EMOTIONS.map((emotion) => [emotion, typeof record[emotion] === "number" ? clamp(record[emotion]) : REST_LEVEL]),
  ) as MoodValues;
  return { values, at: row.moodAt };
}

/** De effectieve Stemming van een rij op tijdstip `now`. */
export function moodOfRow(row: MoodColumns, now: Date): Mood {
  return currentMood(storedMoodOf(row), baseEmotionOf(row), now, row.axisReactivity);
}

/** Amplitude (in punten) van de trage weergave-drift rond de ruststand; geschaald met reactiviteit in `displayMood`. */
export const DRIFT_AMPLITUDE = 10;
/** Hysterese (in punten): de dominante emotie wisselt pas als de kandidaat met minstens dit verschil wint. */
export const DRIFT_HYSTERESIS = 8;

/** Simpele 31-hash naar [0, 2π), voor de fase van elke driftsinus. */
function phaseHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return ((hash % 1000) / 1000) * 2 * Math.PI;
}

// Eén dragende golf (113s) plus twee kleine variaties; gewichten tellen op tot 1. Een gelijk gemiddelde van drie
// sinussen dooft zichzelf grotendeels uit (zelden voorbij ±0.5), waardoor ±DRIFT_AMPLITUDE nooit zichtbaar werd.
const DRIFT_WAVES = [
  { periodMs: 113_000, weight: 0.75 },
  { periodMs: 47_000, weight: 0.2 },
  { periodMs: 271_000, weight: 0.05 },
];

/** Traag, deterministisch golfje in [-1, 1], per emotie+seed anders gefaseerd. */
export function driftOf(emotion: Emotion, seed: string, now: Date): number {
  const t = now.getTime();
  return DRIFT_WAVES.reduce(
    (total, { periodMs, weight }, i) => total + weight * Math.sin((2 * Math.PI * t) / periodMs + phaseHash(`${seed}:${emotion}:${i}`)),
    0,
  );
}

/**
 * Alleen voor weergave (gezichtje, dashboardbalk): de echte Stemming (`currentMood`) plus een trage, per emotie
 * verschillende drift rond de ruststand (ADR-0017). Stateloze hysterese voorkomt dat de dominante emotie
 * heen-en-weer springt door een klein driftverschil.
 */
export function displayMood(stored: StoredMood, baseEmotion: Emotion | null, now: Date, reactivity: number, seed: string): Mood {
  const base = baseEmotion ?? FALLBACK_BASE;
  const truth = currentMood(stored, baseEmotion, now, reactivity);
  const amplitude = DRIFT_AMPLITUDE * Math.min(1, reactivityFactor(reactivity));
  const shown = reconcilePairs(
    Object.fromEntries(EMOTIONS.map((emotion) => [emotion, clamp(truth.values[emotion] + amplitude * driftOf(emotion, seed, now))])) as MoodValues,
  );
  const candidate = dominantOf(shown, base);
  const dominant = candidate !== truth.emotion && shown[candidate] - shown[truth.emotion] < DRIFT_HYSTERESIS ? truth.emotion : candidate;
  return { emotion: dominant, intensity: strength(shown[dominant]), values: shown };
}

/** De weergave-Stemming van een rij op tijdstip `now`, met de rij-id als drift-seed. */
export function displayMoodOfRow(row: MoodColumns & { id: number }, now: Date): Mood {
  return displayMood(storedMoodOf(row), baseEmotionOf(row), now, row.axisReactivity ?? 0.5, String(row.id));
}

/** Eén emotie op de ruststand van `base` plus `intensity` (0–1) erboven, de rest in rust: voor Ontwaakstemming en handmatige override. */
export function singleEmotionValues(emotion: Emotion, intensity: number, base: Emotion = emotion): MoodValues {
  return reconcilePairs({ ...restValues(base), [emotion]: clamp(REST_LEVEL + intensity * (100 - REST_LEVEL)) });
}

/** Dashboard-formulier: veld `mood_<emotie>` (0–100, geclampt) voor elke emotie; null als er één ontbreekt of geen getal is. */
export function parseMoodValues(field: (name: string) => unknown): MoodValues | null {
  const values: Partial<MoodValues> = {};
  for (const emotion of EMOTIONS) {
    const raw = field(`mood_${emotion}`);
    if (typeof raw !== "string" || raw.trim() === "" || Number.isNaN(Number(raw))) return null;
    values[emotion] = clamp(Number(raw));
  }
  return values as MoodValues;
}
