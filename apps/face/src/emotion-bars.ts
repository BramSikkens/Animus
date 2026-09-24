import { EMOTIONS, type Emotion } from "@animus/brain/emotion";

export type EmotionBar = { emotion: Emotion; value: number };

/** De emotievector als balken, hoogste eerst, begrensd tot 0-100. */
export function emotionBars(values: Record<Emotion, number>): EmotionBar[] {
  return EMOTIONS.map((emotion) => ({ emotion, value: Math.min(100, Math.max(0, values[emotion])) })).sort((a, b) => b.value - a.value);
}
