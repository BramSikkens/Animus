import { describe, expect, it } from "vitest";
import { EMOTIONS, EMOTION_PAIRS, oppositeOf } from "../src/emotion.js";

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
});
