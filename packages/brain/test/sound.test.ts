import { describe, expect, it } from "vitest";
import { isVisibleMoodChange, soundKindFor, VISIBLE_EMOTION_MIN_INTENSITY, VISIBLE_INTENSITY_DELTA } from "../src/sound.js";

describe("isVisibleMoodChange", () => {
  it("is zichtbaar bij een andere emotie met genoeg intensiteit", () => {
    expect(isVisibleMoodChange({ emotion: "kalm", intensity: 0.3 }, { emotion: "boos", intensity: VISIBLE_EMOTION_MIN_INTENSITY })).toBe(true);
  });
  it("is niet zichtbaar bij een andere emotie met te lage intensiteit", () => {
    expect(isVisibleMoodChange({ emotion: "kalm", intensity: 0.3 }, { emotion: "boos", intensity: VISIBLE_EMOTION_MIN_INTENSITY - 0.01 })).toBe(false);
  });
  it("is zichtbaar bij dezelfde emotie met een groot intensiteitsverschil", () => {
    expect(isVisibleMoodChange({ emotion: "blij", intensity: 0.3 }, { emotion: "blij", intensity: 0.3 + VISIBLE_INTENSITY_DELTA })).toBe(true);
  });
  it("is niet zichtbaar bij dezelfde emotie met een klein verschil of ongewijzigd", () => {
    expect(isVisibleMoodChange({ emotion: "blij", intensity: 0.5 }, { emotion: "blij", intensity: 0.6 })).toBe(false);
    expect(isVisibleMoodChange({ emotion: "blij", intensity: 0.5 }, { emotion: "blij", intensity: 0.5 })).toBe(false);
  });
});

describe("soundKindFor", () => {
  it("kiest de triggersoort op basis van de nieuwe Stemming-emotie", () => {
    expect(soundKindFor("blij")).toBe("kirren");
    expect(soundKindFor("nieuwsgierig")).toBe("kirren");
    expect(soundKindFor("verrast")).toBe("kirren");
    expect(soundKindFor("boos")).toBe("brommen");
    expect(soundKindFor("bang")).toBe("zuchten");
    expect(soundKindFor("verveeld")).toBe("zuchten");
    expect(soundKindFor("kalm")).toBe("zuchten");
  });
  it("maakt geen geluid bij neutraal", () => {
    expect(soundKindFor("neutraal")).toBeNull();
  });
});
