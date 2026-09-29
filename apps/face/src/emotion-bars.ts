import { EMOTION_GROUPS, type Emotion } from "@animus/core/emotion";

export type EmotionBar = { emotion: Emotion; value: number };

/** De emotievector als balken (0-100) in groepen: eerst elk paar naast elkaar, dan elke emotie zonder tegenpool alleen. */
export function emotionBarGroups(values: Record<Emotion, number>): EmotionBar[][] {
  return EMOTION_GROUPS.map((group) => group.map((emotion) => ({ emotion, value: Math.min(100, Math.max(0, values[emotion])) })));
}
