import { describe, expect, it } from "vitest";
import { frameFor, frameForDisplay } from "./interpolate.js";
import { KEYFRAMES, NEUTRAL, REFLECT, SLEEP } from "./keyframes.js";

describe("frameFor", () => {
  it("neutraal geeft precies het neutrale gezicht, ongeacht intensiteit", () => {
    const frame = frameFor("neutraal", 0.8);
    expect(frame.background).toBe(NEUTRAL.background);
    expect(frame.mouth).toEqual(NEUTRAL.mouth);
    expect(frame.eyes).toEqual(NEUTRAL.eyes);
    expect(frame.brow).toEqual({ angle: 0, raise: 0 });
  });

  it("intensiteit 0 toont de emotie toch op minimum-zichtbaarheid (35% richting doel)", () => {
    // Type1 scoort gewone gesprekszinnen laag (0.02-0.2); zonder ondergrens bleef het gezicht neutraal.
    const expectedCurve = NEUTRAL.mouth.curve * 0.65 + KEYFRAMES.blij.mouth.curve * 0.35;
    expect(frameFor("blij", 0).mouth.curve).toBeCloseTo(expectedCurve);
  });

  it("intensiteit 1 geeft precies het doel-keyframe", () => {
    const frame = frameFor("boos", 1);
    expect(frame.background).toBe(KEYFRAMES.boos.background);
    expect(frame.mouth).toEqual(KEYFRAMES.boos.mouth);
    expect(frame.eyes).toEqual(KEYFRAMES.boos.eyes);
    expect(frame.brow).toEqual(KEYFRAMES.boos.brow);
  });

  it("intensiteit 0.5 geeft t = 0.35 + 0.65 * 0.5, voor een getal en voor de achtergrondkleur", () => {
    const t = 0.35 + 0.65 * 0.5;
    const frame = frameFor("blij", 0.5);
    const expectedCurve = NEUTRAL.mouth.curve * (1 - t) + KEYFRAMES.blij.mouth.curve * t;
    expect(frame.mouth.curve).toBeCloseTo(expectedCurve);

    // Achtergrond: NEUTRAL #555555, blij #b8873f -> per kanaal op t.
    const mid = (a: number, b: number) => Math.round(a * (1 - t) + b * t);
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

describe("frameForDisplay", () => {
  it("toont wakker het emotieframe (frameFor)", () => {
    expect(frameForDisplay("wakker", "blij", 0.7)).toEqual(frameFor("blij", 0.7));
  });

  it("toont slapend het slaapframe, ongeacht emotie en intensiteit", () => {
    expect(frameForDisplay("slapend", "blij", 1)).toEqual(SLEEP);
    expect(frameForDisplay("slapend", "boos", 0)).toEqual(SLEEP);
  });

  it("heeft een slaapframe met (bijna) dichte ogen, vlakke mond en een donkerdere achtergrond dan neutraal", () => {
    expect(SLEEP.eyes.left.open).toBeLessThan(0.2);
    expect(SLEEP.mouth.curve).toBe(0);
    expect(SLEEP.mouth.open).toBe(0);
    const brightness = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(brightness(SLEEP.background)).toBeLessThan(brightness(NEUTRAL.background));
  });
});

describe("reflecterend", () => {
  it("toont het reflectieframe, ongeacht emotie en intensiteit", () => {
    expect(frameForDisplay("reflecterend", "blij", 1)).toEqual(REFLECT);
    expect(frameForDisplay("reflecterend", "boos", 0)).toEqual(REFLECT);
  });

  it("heeft half gesloten ogen met de blik omhoog, een rustige vlakke mond en een eigen achtergrond", () => {
    expect(REFLECT.eyes.left.open).toBeGreaterThan(SLEEP.eyes.left.open);
    expect(REFLECT.eyes.left.open).toBeLessThan(NEUTRAL.eyes.left.open);
    expect(REFLECT.eyes.left.pupilY).toBeLessThan(0); // blik omhoog
    expect(REFLECT.mouth.curve).toBe(0);
    expect(REFLECT.mouth.open).toBe(0);
    expect(REFLECT.background).not.toBe(SLEEP.background);
    expect(REFLECT.background).not.toBe(NEUTRAL.background);
  });
});
