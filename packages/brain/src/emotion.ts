// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
export const EMOTIONS = ["blij", "boos", "verrast", "kalm", "verveeld", "nieuwsgierig", "bang", "neutraal"] as const;
export type Emotion = (typeof EMOTIONS)[number];

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
