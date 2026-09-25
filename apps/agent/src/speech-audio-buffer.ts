// Int16Array<ArrayBufferLike>: subarray() geeft dat type terug, niet het striktere Int16Array<ArrayBuffer>.
type Int16Buf = Int16Array<ArrayBufferLike>;

function concatInt16(a: Int16Buf, b: Int16Buf): Int16Buf {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Buffert PCM-frames terwijl de Gesprekspartner spreekt (stemherkenning, #92): een korte pre-roll (frames van
 * vlak vóór het spreken) zodat het begin van de uiting niet verloren gaat, met een bovengrens zodat een lang
 * openstaande "speaking"-toestand niet onbeperkt geheugen opeet.
 */
export function createSpeechAudioBuffer({ prerollSamples, maxSamples }: { prerollSamples: number; maxSamples: number }): {
  /** Eén frame; `speaking` is `session.userState === "speaking"` op het moment van dit frame. */
  push(frame: Int16Buf, speaking: boolean): void;
  /** Geeft de gebufferde uiting (pre-roll + spraak) terug en leegt de buffer. */
  drain(): Int16Buf;
} {
  let preroll: Int16Buf = new Int16Array(0);
  let speech: Int16Buf[] = [];
  let speechSamples = 0;

  return {
    push(frame, speaking) {
      if (!speaking) {
        const combined = concatInt16(preroll, frame);
        preroll = combined.length > prerollSamples ? combined.subarray(combined.length - prerollSamples) : combined;
        return;
      }
      if (speech.length === 0) speech.push(preroll);
      const room = maxSamples - speechSamples;
      if (room <= 0) return;
      const toAdd = frame.length > room ? frame.subarray(0, room) : frame;
      speech.push(toAdd);
      speechSamples += toAdd.length;
    },
    drain() {
      const combined = speech.reduce(concatInt16, new Int16Array(0));
      speech = [];
      speechSamples = 0;
      return combined;
    },
  };
}
