import { describe, expect, it } from "vitest";
import { createSpeechAudioBuffer } from "./speech-audio-buffer.js";

describe("createSpeechAudioBuffer", () => {
  it("neemt de pre-roll mee zodra speaking start", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 4, maxSamples: 100 });
    buffer.push(new Int16Array([1, 2, 3, 4, 5]), false); // pre-roll capt op de laatste 4: [2,3,4,5]
    buffer.push(new Int16Array([9]), true);
    expect(Array.from(buffer.drain())).toEqual([2, 3, 4, 5, 9]);
  });

  it("negeert frames terwijl er niet gesproken wordt", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 4, maxSamples: 100 });
    buffer.push(new Int16Array([1, 2]), false);
    expect(Array.from(buffer.drain())).toEqual([]);
  });

  it("cap op maxSamples: latere samples worden afgekapt", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 0, maxSamples: 3 });
    buffer.push(new Int16Array([1, 2]), true);
    buffer.push(new Int16Array([3, 4]), true); // zou 4 samples maken; blijft op 3 (het laatste sample past niet meer)
    expect(Array.from(buffer.drain())).toEqual([1, 2, 3]);
  });

  it("drain leegt de buffer", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 0, maxSamples: 100 });
    buffer.push(new Int16Array([1]), true);
    buffer.drain();
    expect(Array.from(buffer.drain())).toEqual([]);
  });
});
