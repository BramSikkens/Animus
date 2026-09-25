import { describe, expect, it } from "vitest";
import { injectSpeechSounds, pickSpeechSound } from "../src/speech-sounds.js";
import { singleEmotionValues } from "../src/mood.js";
import type { Axes } from "../src/personality.js";

const axes = (overrides: Partial<Axes> = {}): Axes => ({ ie: 0.5, sn: 0.5, tf: 0.5, jp: 0.5, reactivity: 0.5, expressiveness: 1, ...overrides });
const rng = (value: number) => () => value;
const TEXT = "Dat is een leuk verhaal, vertel maar verder.";

describe("injectSpeechSounds: type volgt dominante emotie", () => {
  it("blij: lach vooraan", () => {
    expect(injectSpeechSounds({ text: TEXT, values: singleEmotionValues("blij", 1), axes: axes(), rng: rng(0) })).toBe(`ha ha ${TEXT}`);
  });

  it.each([
    ["bang", "hmm…"],
    ["verveeld", "pff…"],
    ["droevig", "pff…"],
    ["nieuwsgierig", "hmm…"],
    ["verrast", "oh!"],
  ] as const)("%s: %s", (emotion, sound) => {
    expect(injectSpeechSounds({ text: TEXT, values: singleEmotionValues(emotion, 1), axes: axes(), rng: rng(0) })).toBe(`${sound} ${TEXT}`);
  });

  it("twijfel: hoge P (jp) geeft aarzeling bij een emotie zonder eigen geluid", () => {
    expect(injectSpeechSounds({ text: TEXT, values: singleEmotionValues("kalm", 1), axes: axes({ jp: 0.9 }), rng: rng(0) })).toBe(`eh… ${TEXT}`);
    expect(injectSpeechSounds({ text: TEXT, values: singleEmotionValues("kalm", 1), axes: axes({ jp: 0.1 }), rng: rng(0) })).toBe(TEXT);
  });
});

describe("injectSpeechSounds: kans en uitzonderingen", () => {
  const blij = singleEmotionValues("blij", 1);
  it("expressiviteit 0: nooit", () => {
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes({ expressiveness: 0 }), rng: rng(0) })).toBe(TEXT);
  });
  it("kans schaalt met expressiviteit en emotiewaarde", () => {
    // basiskans 0.5 (SPEECH_SOUND_CHANCE) * 1 * 1 = 0.5
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes(), rng: rng(0.49) })).toContain("ha ha");
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes(), rng: rng(0.51) })).toBe(TEXT);
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes({ expressiveness: 0.5 }), rng: rng(0.3) })).toBe(TEXT);
    expect(injectSpeechSounds({ text: TEXT, values: singleEmotionValues("blij", 0.5), axes: axes(), rng: rng(0.3) })).toBe(TEXT);
  });
  it("geen minimumlengte: het geluid wordt vooraf gekozen, ook vóór een heel kort antwoord", () => {
    expect(pickSpeechSound({ values: blij, axes: axes(), rng: rng(0) })).toBe("ha ha");
    expect(injectSpeechSounds({ text: "Ja.", values: blij, axes: axes(), rng: rng(0) })).toBe("ha ha Ja.");
  });
  it("isShort (behavior kort): geen geluid", () => {
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes(), rng: rng(0), isShort: true })).toBe(TEXT);
  });
  it("niet twee beurten achter elkaar hetzelfde geluid", () => {
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes(), rng: rng(0), previous: "ha ha" })).toBe(TEXT);
    expect(injectSpeechSounds({ text: TEXT, values: blij, axes: axes(), rng: rng(0), previous: "hmm…" })).toContain("ha ha");
  });
});
