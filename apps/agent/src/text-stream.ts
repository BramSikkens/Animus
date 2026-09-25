import { ReadableStream } from "node:stream/web";
import type { BrainEvent } from "@animus/brain";
import type { EmotionMessage } from "@animus/brain/emotion";
import type { SoundKind } from "@animus/brain/sound";

export type TextStreamOptions = {
  /** Aangeroepen zodra een `sound`-event (zichtbare Stemmingsverandering) voorbijkomt (ticket #40). */
  onSound?: (kind: SoundKind) => void;
  /** Aangeroepen zodra een `mood`-event (de Stemming) voorbijkomt, vóór er tekst in de stream komt. */
  onMood?: (mood: EmotionMessage) => void;
  /** Aangeroepen zodra een `kijk`-event voorbijkomt: er ging deze beurt een camerabeeld naar Type2. */
  onLook?: () => void;
};

/**
 * Zet de `BrainEvent`-stroom van `brain.hear()` om naar enkel de tekst-deltas, zodat de
 * TTS al kan beginnen terwijl Type2 nog aan het antwoorden is.
 *
 * tool-*-events worden hier genegeerd (ticket #7). `mood`-events roepen `options.onMood`
 * aan (ticket #8, publicatie op het LiveKit data channel gebeurt in agent.ts).
 *
 * Gooit de bron een fout (bv. `hear()` faalt halverwege een beurt), dan wordt dat gelogd en
 * sluit de stream netjes af, zodat één mislukte beurt de sessie niet laat crashen.
 */
export function textStream(events: AsyncIterable<BrainEvent>, options?: TextStreamOptions): ReadableStream<string> {
  const it = events[Symbol.asyncIterator]();
  return new ReadableStream<string>({
    async pull(controller) {
      for (;;) {
        let result: IteratorResult<BrainEvent>;
        try {
          result = await it.next();
        } catch (error) {
          console.error("Brain-stream faalde tijdens een beurt:", error instanceof Error ? error.message : error);
          controller.close();
          return;
        }
        if (result.done) {
          controller.close();
          return;
        }
        if (result.value.type === "text") {
          controller.enqueue(result.value.delta);
          return;
        }
        if (result.value.type === "mood") {
          options?.onMood?.({ emotion: result.value.emotion, intensity: result.value.intensity, values: result.value.values });
          continue;
        }
        if (result.value.type === "sound") {
          options?.onSound?.(result.value.kind);
          continue;
        }
        if (result.value.type === "kijk") {
          options?.onLook?.();
          continue;
        }
        // tool-* event: overslaan, volgende event proberen.
      }
    },
    async cancel() {
      await it.return?.();
    },
  });
}
