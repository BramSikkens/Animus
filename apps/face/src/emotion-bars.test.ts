import { describe, expect, it } from "vitest";
import { EMOTIONS, type Emotion } from "@animus/brain/emotion";
import { emotionBars } from "./emotion-bars.js";

const zeros = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<Emotion, number>;

describe("emotionBars", () => {
  it("sorteert aflopend op waarde", () => {
    const bars = emotionBars({ ...zeros, blij: 20, boos: 70, kalm: 40 });
    expect(bars.slice(0, 3).map((b) => b.emotion)).toEqual(["boos", "kalm", "blij"]);
  });

  it("begrenst waarden tot 0-100", () => {
    const bars = emotionBars({ ...zeros, blij: 130, boos: -5 });
    expect(bars.find((b) => b.emotion === "blij")?.value).toBe(100);
    expect(bars.find((b) => b.emotion === "boos")?.value).toBe(0);
  });
});
