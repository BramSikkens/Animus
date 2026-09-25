import { describe, expect, it } from "vitest";
import { bestMatch, DEFAULT_SPEAKER_MATCH_THRESHOLD, parseSpeakerMatchThreshold } from "./speaker-id.js";

describe("bestMatch", () => {
  it("geeft de Persoon met het hoogste maximum boven de drempel", () => {
    const result = bestMatch({ scoresPerProfile: [0.2, 0.9, 0.3], profilePersonIds: [1, 2, 1], threshold: 0.5 });
    expect(result).toEqual({ personId: 2, score: 0.9 });
  });

  it("neemt per Persoon het maximum over zijn (hoogstens 5) profielen", () => {
    const result = bestMatch({ scoresPerProfile: [0.6, 0.55, 0.9], profilePersonIds: [1, 1, 2], threshold: 0.5 });
    // Persoon 1: max(0.6, 0.55) = 0.6; Persoon 2: 0.9 wint.
    expect(result).toEqual({ personId: 2, score: 0.9 });
  });

  it("niets boven de drempel geeft null", () => {
    expect(bestMatch({ scoresPerProfile: [0.1, 0.2], profilePersonIds: [1, 2], threshold: 0.5 })).toBeNull();
  });

  it("geen profielen geeft null", () => {
    expect(bestMatch({ scoresPerProfile: [], profilePersonIds: [], threshold: 0.5 })).toBeNull();
  });

  it("exact op de drempel telt mee", () => {
    expect(bestMatch({ scoresPerProfile: [0.5], profilePersonIds: [1], threshold: 0.5 })).toEqual({ personId: 1, score: 0.5 });
  });
});

describe("parseSpeakerMatchThreshold", () => {
  it("default zonder waarde", () => {
    expect(parseSpeakerMatchThreshold(undefined)).toEqual({ threshold: DEFAULT_SPEAKER_MATCH_THRESHOLD });
    expect(parseSpeakerMatchThreshold("")).toEqual({ threshold: DEFAULT_SPEAKER_MATCH_THRESHOLD });
  });

  it("een geldige waarde binnen 0–1", () => {
    expect(parseSpeakerMatchThreshold("0.7")).toEqual({ threshold: 0.7 });
  });

  it.each(["nope", "-0.1", "1.1"])("ongeldige waarde %s: default met waarschuwing", (value) => {
    const result = parseSpeakerMatchThreshold(value);
    expect(result.threshold).toBe(DEFAULT_SPEAKER_MATCH_THRESHOLD);
    expect(result.warning).toBeDefined();
  });
});
