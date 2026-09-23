// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
export const EMOTIONS = ["blij", "boos", "verrast", "kalm", "verveeld", "nieuwsgierig", "bang", "neutraal"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && (EMOTIONS as readonly string[]).includes(value);
}

/** Bericht op het LiveKit data channel, van agent naar gezichtje. */
export type EmotionMessage = { emotion: Emotion; intensity: number };
export const EMOTION_TOPIC = "emotion";
