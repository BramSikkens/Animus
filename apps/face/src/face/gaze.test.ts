import { describe, expect, it } from "vitest";
import { facePointer, gazeOffset } from "./gaze.js";

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

describe("facePointer", () => {
  const viewport = { w: 1000, h: 800 };

  it("gezicht links in beeld geeft een aanwijzer rechts van het midden (gespiegeld)", () => {
    const { x } = facePointer({ face: { x: 0.2, y: 0.5 }, viewport });
    expect(x).toBeGreaterThan(viewport.w / 2);
  });

  it("gezicht in het midden geeft de aanwijzer in het midden van het venster", () => {
    expect(facePointer({ face: { x: 0.5, y: 0.5 }, viewport })).toEqual({ x: 500, y: 400 });
  });

  it("gezicht links in beeld levert via gazeOffset pupillen naar rechts (dx > 0)", () => {
    const pointer = facePointer({ face: { x: 0.2, y: 0.5 }, viewport });
    const { dx } = gazeOffset({ pointer, viewport, faceCenter: { x: viewport.w / 2, y: viewport.h / 2 }, max: 3 });
    expect(dx).toBeGreaterThan(0);
  });
});
