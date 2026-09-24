// Browser-veilig: geen node-imports. Pure Spraakgeluiden ('hmm…', 'ha ha') die vóór TTS aan een beurt worden toegevoegd.
// Geschreven vorm i.p.v. audio tags (ElevenLabs Flash v2.5 ondersteunt die niet; Deepgram spreekt de tekst ook gewoon uit).
import type { Emotion } from "./emotion.js";
import type { MoodValues } from "./mood.js";
import type { Axes } from "./personality.js";

/** Basiskans op een geluid per beurt, vóór × expressiviteit (0-1) en × waarde van de dominante Emotie (0-1). */
export const SPEECH_SOUND_CHANCE = 0.5;
/** Antwoorden korter dan dit aantal tekens krijgen nooit een geluid. */
export const SPEECH_SOUND_MIN_LENGTH = 20;
/** Boven deze jp-waarde (richting P) valt een Emotie zonder eigen geluid terug op aarzeling. */
export const HESITATION_JP = 0.6;

export const LAUGH = "ha ha";
export const SIGH = "pff…";
export const HMM = "hmm…";
export const SURPRISE = "oh!";
export const HESITATION = "eh…";

/** Geluid per dominante Emotie; ontbrekende Emoties krijgen alleen (bij hoge jp) aarzeling. */
const SOUND_BY_EMOTION: Partial<Record<Emotion, string>> = {
  blij: LAUGH,
  bang: HMM,
  verveeld: SIGH,
  droevig: SIGH,
  nieuwsgierig: HMM,
  verrast: SURPRISE,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Het te gebruiken geluid voor deze beurt, of null. `previous`: het geluid van de vorige beurt (geen herhaling). */
export function pickSpeechSound({ textLength, values, axes, rng, isShort = false, previous }: { textLength: number; values: MoodValues; axes: Axes; rng: () => number; isShort?: boolean; previous?: string }): string | null {
  if (isShort || textLength < SPEECH_SOUND_MIN_LENGTH || axes.expressiveness <= 0) return null;
  const [top, value] = (Object.entries(values) as [Emotion, number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
  const sound = SOUND_BY_EMOTION[top] ?? (axes.jp > HESITATION_JP ? HESITATION : undefined);
  if (!sound || sound === previous) return null;
  const chance = clamp01(SPEECH_SOUND_CHANCE * clamp01(axes.expressiveness) * clamp01(value / 100));
  return rng() < chance ? sound : null;
}

/** Zet het gekozen geluid (of niets) vóór de tekst. */
export function injectSpeechSounds(args: { text: string; values: MoodValues; axes: Axes; rng: () => number; isShort?: boolean; previous?: string }): string {
  const sound = pickSpeechSound({ ...args, textLength: args.text.length });
  return sound ? `${sound} ${args.text}` : args.text;
}
