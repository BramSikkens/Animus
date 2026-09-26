// Int16Array<ArrayBufferLike>: subarray() geeft dat type terug, niet het striktere Int16Array<ArrayBuffer>.
export type Int16Buf = Int16Array<ArrayBufferLike>;

/** Plakt twee PCM-buffers aan elkaar (nieuwe allocatie). Eén definitie, gedeeld door de audio-buffer en Eagle-adapter. */
export function concatInt16(a: Int16Buf, b: Int16Buf): Int16Buf {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
