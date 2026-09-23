import { describe, expect, it } from "vitest";
import { frameFor } from "./interpolate.js";
import { KEYFRAMES, NEUTRAL } from "./keyframes.js";

describe("frameFor", () => {
  it("intensiteit 0 geeft precies neutraal", () => {
    const frame = frameFor("blij", 0);
    expect(frame.background).toBe(NEUTRAL.background);
    expect(frame.mouth).toEqual(NEUTRAL.mouth);
    expect(frame.eyes).toEqual(NEUTRAL.eyes);
    expect(frame.brow).toEqual({ angle: 0, raise: 0 });
  });

  it("intensiteit 1 geeft precies het doel-keyframe", () => {
    const frame = frameFor("boos", 1);
    expect(frame.background).toBe(KEYFRAMES.boos.background);
    expect(frame.mouth).toEqual(KEYFRAMES.boos.mouth);
    expect(frame.eyes).toEqual(KEYFRAMES.boos.eyes);
    expect(frame.brow).toEqual(KEYFRAMES.boos.brow);
  });

  it("0.5 ligt midden tussen neutraal en doel, voor een getal en voor de achtergrondkleur", () => {
    const frame = frameFor("blij", 0.5);
    const expectedCurve = (NEUTRAL.mouth.curve + KEYFRAMES.blij.mouth.curve) / 2;
    expect(frame.mouth.curve).toBeCloseTo(expectedCurve);

    // Achtergrond: NEUTRAL #555555, blij #b8873f -> per kanaal middenin.
    const mid = (a: number, b: number) => Math.round((a + b) / 2);
    const r = mid(0x55, 0xb8);
    const g = mid(0x55, 0x87);
    const b = mid(0x55, 0x3f);
    const expectedHex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    expect(frame.background).toBe(expectedHex);
  });

  it("voor emoties zonder brow blijft die {0,0}, ook bij intensiteit 1", () => {
    expect(frameFor("kalm", 1).brow).toEqual({ angle: 0, raise: 0 });
  });

  it("intensiteiten buiten [0,1] worden geclampt", () => {
    expect(frameFor("boos", -5)).toEqual(frameFor("boos", 0));
    expect(frameFor("boos", 5)).toEqual(frameFor("boos", 1));
  });
});
