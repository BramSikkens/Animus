import { concatInt16, type Int16Buf } from "./pcm.js";

/**
 * Buffert PCM-frames terwijl de Gesprekspartner spreekt (stemherkenning, #92): een korte pre-roll (frames van
 * vlak vóór het spreken) zodat het begin van de uiting niet verloren gaat, met een bovengrens die de NIEUWSTE
 * audio bewaart (oudste frames vallen weg) zodat een lang openstaande "speaking"-toestand niet onbeperkt
 * geheugen opeet en de meest recente (dus relevantste) audio niet verliest.
 */
export function createSpeechAudioBuffer({ prerollSamples, maxSamples }: { prerollSamples: number; maxSamples: number }): {
  /** Eén frame; `speaking` is `session.userState === "speaking"` op het moment van dit frame. */
  push(frame: Int16Buf, speaking: boolean): void;
  /** Geeft de gebufferde uiting (pre-roll + spraak) terug en leegt de buffer. */
  drain(): Int16Buf;
} {
  let preroll: Int16Buf = new Int16Array(0);
  let chunks: Int16Buf[] = [];
  let total = 0;

  // Verwijdert oudste chunks/samples tot de buffer weer binnen maxSamples past.
  function trimToCap(): void {
    while (total > maxSamples && chunks.length > 0) {
      const excess = total - maxSamples;
      const first = chunks[0]!;
      if (first.length <= excess) {
        chunks.shift();
        total -= first.length;
      } else {
        chunks[0] = first.subarray(excess);
        total -= excess;
      }
    }
  }

  return {
    push(frame, speaking) {
      if (!speaking) {
        const combined = concatInt16(preroll, frame);
        preroll = combined.length > prerollSamples ? combined.subarray(combined.length - prerollSamples) : combined;
        return;
      }
      if (chunks.length === 0 && total === 0) {
        chunks.push(preroll);
        total += preroll.length;
      }
      chunks.push(frame);
      total += frame.length;
      trimToCap();
    },
    drain() {
      // Eén allocatie op de totale lengte i.p.v. een concat per chunk (O(n) i.p.v. O(n²)).
      const out = new Int16Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      chunks = [];
      total = 0;
      return out;
    },
  };
}
