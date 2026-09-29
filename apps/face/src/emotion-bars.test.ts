import { describe, expect, it } from "vitest";
import { EMOTIONS, EMOTION_PAIRS, type Emotion } from "@animus/core/emotion";
import { emotionBarGroups } from "./emotion-bars.js";

const zeros = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<Emotion, number>;

describe("emotionBarGroups", () => {
  it("zet elk paar naast elkaar in één groep, met de paren eerst in de volgorde van EMOTION_PAIRS", () => {
    const groups = emotionBarGroups(zeros);
    expect(groups.slice(0, EMOTION_PAIRS.length).map((g) => g.map((b) => b.emotion))).toEqual(EMOTION_PAIRS.map((pair) => [...pair]));
  });

  it("geeft elke emotie zonder tegenpool een eigen groep van één balk; alle emoties komen precies één keer voor", () => {
    const groups = emotionBarGroups(zeros);
    expect(groups.slice(EMOTION_PAIRS.length).every((g) => g.length === 1)).toBe(true);
    expect(groups.flat().map((b) => b.emotion).sort()).toEqual([...EMOTIONS].sort());
  });

  it("begrenst waarden tot 0-100", () => {
    const bars = emotionBarGroups({ ...zeros, blij: 130, boos: -5 }).flat();
    expect(bars.find((b) => b.emotion === "blij")?.value).toBe(100);
    expect(bars.find((b) => b.emotion === "boos")?.value).toBe(0);
  });
});
