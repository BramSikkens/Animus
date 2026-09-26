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

  it("cap op maxSamples: de OUDSTE samples vallen weg, de nieuwste blijven", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 0, maxSamples: 3 });
    buffer.push(new Int16Array([1, 2]), true);
    buffer.push(new Int16Array([3, 4]), true); // zou 4 samples maken; de oudste (1) valt weg
    expect(Array.from(buffer.drain())).toEqual([2, 3, 4]);
  });

  it("cap: een frame groter dan de hele cap laat enkel het nieuwste stuk over", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 0, maxSamples: 2 });
    buffer.push(new Int16Array([1, 2, 3, 4, 5]), true);
    expect(Array.from(buffer.drain())).toEqual([4, 5]);
  });

  it("veel kleine frames: drain geeft alles in volgorde (O(n)-pad, geen kwadratische heropbouw)", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 0, maxSamples: 100_000 });
    const frameCount = 2000;
    for (let i = 0; i < frameCount; i++) buffer.push(new Int16Array([i]), true);
    const drained = buffer.drain();
    expect(drained.length).toBe(frameCount);
    expect(drained[0]).toBe(0);
    expect(drained[frameCount - 1]).toBe(frameCount - 1);
  });

  it("drain leegt de buffer", () => {
    const buffer = createSpeechAudioBuffer({ prerollSamples: 0, maxSamples: 100 });
    buffer.push(new Int16Array([1]), true);
    buffer.drain();
    expect(Array.from(buffer.drain())).toEqual([]);
  });
});
