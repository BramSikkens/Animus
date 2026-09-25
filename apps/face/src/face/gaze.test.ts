import { describe, expect, it } from "vitest";
import { gazeOffset } from "./gaze.js";

const base = { viewport: { w: 1000, h: 800 }, faceCenter: { x: 500, y: 400 }, max: 3 };

describe("gazeOffset", () => {
  it("geeft {0,0} zonder aanwijzer", () => {
    expect(gazeOffset({ ...base, pointer: null })).toEqual({ dx: 0, dy: 0 });
  });

  it("kijkt richting de aanwijzer (rechtsonder = positief)", () => {
    const { dx, dy } = gazeOffset({ ...base, pointer: { x: 750, y: 600 } });
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
    const left = gazeOffset({ ...base, pointer: { x: 250, y: 200 } });
    expect(left.dx).toBeLessThan(0);
    expect(left.dy).toBeLessThan(0);
  });

  it("clampt op max, ook ver buiten het venster", () => {
    expect(gazeOffset({ ...base, pointer: { x: 99999, y: -99999 } })).toEqual({ dx: 3, dy: -3 });
  });

  it("aanwijzer op het gezicht geeft {0,0}", () => {
    expect(gazeOffset({ ...base, pointer: { x: 500, y: 400 } })).toEqual({ dx: 0, dy: 0 });
  });
});
