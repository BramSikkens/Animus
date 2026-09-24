import { EMOTIONS, EMOTION_PAIRS, oppositeOf, type Emotion } from "@animus/brain/emotion";

export type EmotionBar = { emotion: Emotion; value: number };

/** De emotievector als balken (0-100) in groepen: eerst elk paar naast elkaar, dan elke emotie zonder tegenpool alleen. */
export function emotionBarGroups(values: Record<Emotion, number>): EmotionBar[][] {
  const bar = (emotion: Emotion): EmotionBar => ({ emotion, value: Math.min(100, Math.max(0, values[emotion])) });
  return [
    ...EMOTION_PAIRS.map((pair) => pair.map(bar)),
    ...EMOTIONS.filter((emotion) => !oppositeOf(emotion)).map((emotion) => [bar(emotion)]),
  ];
}
