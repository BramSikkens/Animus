import type { SoundKind } from "@animus/brain/sound";

/** Aantal opgenomen clips per triggersoort (public/sounds/<soort>-1..N.wav). */
export const CLIPS_PER_KIND = 2;

/** Willekeurige clip uit de set van deze soort; `random` is injecteerbaar voor tests. */
export function clipUrl(kind: SoundKind, random: () => number = Math.random): string {
  return `/sounds/${kind}-${Math.floor(random() * CLIPS_PER_KIND) + 1}.wav`;
}
