import { describe, expect, it } from "vitest";
import { EMOTIONS, EMOTION_GROUPS, EMOTION_PAIRS, oppositeOf } from "../src/emotion.js";

describe("emotie-paren", () => {
  it("kent droevig, vredig en druk", () => {
    expect(EMOTIONS).toEqual(expect.arrayContaining(["droevig", "vredig", "druk", "kalm"]));
  });

  it("paart boos↔vredig, blij↔droevig en druk↔kalm", () => {
    expect(EMOTION_PAIRS).toEqual([["boos", "vredig"], ["blij", "droevig"], ["druk", "kalm"]]);
  });

  it("oppositeOf werkt in beide richtingen; emoties zonder paar hebben geen tegenpool", () => {
    expect(oppositeOf("blij")).toBe("droevig");
    expect(oppositeOf("droevig")).toBe("blij");
    expect(oppositeOf("kalm")).toBe("druk");
    expect(oppositeOf("bang")).toBeNull();
  });

  it("EMOTION_GROUPS: eerst de paren, dan elke emotie zonder tegenpool alleen; elke emotie precies één keer", () => {
    expect(EMOTION_GROUPS.slice(0, 3)).toEqual(EMOTION_PAIRS.map((pair) => [...pair]));
    expect(EMOTION_GROUPS.slice(3).every((group) => group.length === 1)).toBe(true);
    expect(EMOTION_GROUPS.flat().sort()).toEqual([...EMOTIONS].sort());
  });
});
