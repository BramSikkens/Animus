// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
export const EMOTIONS = ["blij", "boos", "verrast", "kalm", "verveeld", "nieuwsgierig", "bang", "droevig", "vredig", "druk"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Tegenpolen (ADR-0015): de ene kant remt de andere af. Emoties buiten de paren hebben geen tegenpool. */
export const EMOTION_PAIRS = [
  ["boos", "vredig"],
  ["blij", "droevig"],
  ["druk", "kalm"],
] as const satisfies readonly (readonly [Emotion, Emotion])[];

export function oppositeOf(emotion: Emotion): Emotion | null {
  for (const [a, b] of EMOTION_PAIRS) {
    if (emotion === a) return b;
    if (emotion === b) return a;
  }
  return null;
}

/** Weergavegroepen voor face en dashboard: eerst elk paar, dan elke emotie zonder tegenpool alleen. */
export const EMOTION_GROUPS: Emotion[][] = [
  ...EMOTION_PAIRS.map((pair) => [...pair]),
  ...EMOTIONS.filter((emotion) => !oppositeOf(emotion)).map((emotion) => [emotion]),
];

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && (EMOTIONS as readonly string[]).includes(value);
}

/** Bericht op het LiveKit data channel, van agent naar gezichtje. */
export type EmotionMessage = {
  /** De zichtbare (dominante) emotie: de hoogste waarde in `values`. */
  emotion: Emotion;
  /** De waarde van de dominante emotie als 0–1. */
  intensity: number;
  /** De volledige vector: elke emotie 0–100. */
  values: Record<Emotion, number>;
};
export const EMOTION_TOPIC = "emotion";
