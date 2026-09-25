import { describe, expect, it } from "vitest";
import { singleEmotionValues } from "../src/mood.js";
import { voiceSettingsFor } from "../src/voice-emotion.js";

const NEUTRAL = { stability: 0.5, style: 0, speed: 1, similarity_boost: 0.75 };

describe("voiceSettingsFor", () => {
  it("geeft bij expressiviteit 0 altijd de neutrale basis", () => {
    expect(voiceSettingsFor({ values: singleEmotionValues("boos", 1), expressiveness: 0 })).toEqual(NEUTRAL);
  });

  it("blij: hogere style, iets sneller, lagere stability", () => {
    const s = voiceSettingsFor({ values: singleEmotionValues("blij", 1), expressiveness: 1 });
    expect(s.style).toBeGreaterThan(0.2);
    expect(s.speed).toBeGreaterThan(1);
    expect(s.stability).toBeLessThan(0.5);
  });

  const at = (emotion: Parameters<typeof singleEmotionValues>[0]) => voiceSettingsFor({ values: singleEmotionValues(emotion, 1), expressiveness: 1 });

  it("boos: hoge style, lagere stability, iets sneller", () => {
    const s = at("boos");
    expect(s.style).toBeGreaterThanOrEqual(0.5);
    expect(s.stability).toBeLessThan(0.5);
    expect(s.speed).toBeGreaterThan(1);
  });

  it("bang: lagere stability en sneller", () => {
    const s = at("bang");
    expect(s.stability).toBeLessThan(0.5);
    expect(s.speed).toBeGreaterThan(1.05);
  });

  it("verveeld en kalm: hogere stability en langzamer", () => {
    for (const emotion of ["verveeld", "kalm"] as const) {
      const s = at(emotion);
      expect(s.stability).toBeGreaterThan(0.5);
      expect(s.speed).toBeLessThan(1);
    }
  });

  it("droevig: langzaam, hogere stability, lage style", () => {
    const s = at("droevig");
    expect(s.speed).toBeLessThan(1);
    expect(s.stability).toBeGreaterThan(0.5);
    expect(s.style).toBeLessThan(0.1);
  });

  it("vredig: langzaam, hoge stability", () => {
    const s = at("vredig");
    expect(s.speed).toBeLessThan(1);
    expect(s.stability).toBeGreaterThan(0.7);
  });

  it("druk: snel, lage stability", () => {
    const s = at("druk");
    expect(s.speed).toBeGreaterThan(1.05);
    expect(s.stability).toBeLessThan(0.4);
  });

  it("verrast en nieuwsgierig: matige style", () => {
    for (const emotion of ["verrast", "nieuwsgierig"] as const) {
      const s = at(emotion);
      expect(s.style).toBeGreaterThan(0.1);
      expect(s.style).toBeLessThan(0.4);
    }
  });

  it("zonder emotiewaarde blijft de stem neutraal", () => {
    expect(voiceSettingsFor({ values: singleEmotionValues("boos", 0), expressiveness: 1 })).toEqual(NEUTRAL);
  });

  it("schaalt met expressiviteit en met de waarde van de emotie", () => {
    const full = voiceSettingsFor({ values: singleEmotionValues("boos", 1), expressiveness: 1 });
    const half = voiceSettingsFor({ values: singleEmotionValues("boos", 1), expressiveness: 0.5 });
    const weak = voiceSettingsFor({ values: singleEmotionValues("boos", 0.1), expressiveness: 1 });
    expect(half.style).toBeCloseTo(full.style / 2);
    expect(weak.style).toBeLessThan(full.style / 5);
  });

  it("clampt binnen geldige ranges bij een extreme vector", () => {
    const values = { blij: 100, boos: 100, verrast: 100, kalm: 0, verveeld: 0, nieuwsgierig: 100, bang: 100, droevig: 0, vredig: 0, druk: 100 };
    const s = voiceSettingsFor({ values, expressiveness: 1 });
    expect(s.style).toBeLessThanOrEqual(1);
    expect(s.stability).toBeGreaterThanOrEqual(0);
    expect(s.speed).toBeLessThanOrEqual(1.2);
    const slow = voiceSettingsFor({ values: { ...values, blij: 0, boos: 0, verrast: 0, nieuwsgierig: 0, bang: 0, verveeld: 100, kalm: 100, druk: 0, droevig: 100, vredig: 100 }, expressiveness: 1 });
    expect(slow.speed).toBeGreaterThanOrEqual(0.7);
    expect(slow.stability).toBeLessThanOrEqual(1);
  });
});
