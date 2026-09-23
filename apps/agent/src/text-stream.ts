import { ReadableStream } from "node:stream/web";
import type { BrainEvent } from "@animus/brain";

/**
 * Zet de `BrainEvent`-stroom van `brain.hear()` om naar enkel de tekst-deltas, zodat de
 * TTS al kan beginnen terwijl Type2 nog aan het antwoorden is.
 *
 * emotion- en tool-*-events worden hier genegeerd (ticket #7); ticket #8 publiceert de
 * emotie op het LiveKit data channel.
 *
 * Gooit de bron een fout (bv. `hear()` faalt halverwege een beurt), dan wordt dat gelogd en
 * sluit de stream netjes af, zodat één mislukte beurt de sessie niet laat crashen.
 */
export function textStream(events: AsyncIterable<BrainEvent>): ReadableStream<string> {
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
        // emotion/tool-* event: overslaan, volgende event proberen.
      }
    },
    async cancel() {
      await it.return?.();
    },
  });
}
