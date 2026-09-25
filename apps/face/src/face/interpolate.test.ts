import { describe, expect, it } from "vitest";
import { frameFor, frameForDisplay } from "./interpolate.js";
import { KEYFRAMES, NEUTRAL, REFLECT, SLEEP } from "./keyframes.js";

describe("frameFor", () => {
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

  it("droevig, vredig en druk hebben een eigen keyframe en tweenen naar het doel", () => {
    for (const emotion of ["droevig", "vredig", "druk"] as const) {
      expect(KEYFRAMES[emotion].background).toMatch(/^#[0-9a-f]{6}$/);
      expect(KEYFRAMES[emotion].background).not.toBe(NEUTRAL.background);
      const frame = frameFor(emotion, 1);
      expect(frame.background).toBe(KEYFRAMES[emotion].background);
      expect(frame.mouth).toEqual(KEYFRAMES[emotion].mouth);
    }
  });

  it("droevig: mondhoeken omlaag; vredig: zachte lach, halfdichte ogen; druk: wijd open ogen", () => {
    expect(KEYFRAMES.droevig.mouth.curve).toBeLessThan(0);
    expect(KEYFRAMES.vredig.mouth.curve).toBeGreaterThan(0);
    expect(KEYFRAMES.vredig.eyes.left.open).toBeLessThan(1);
    expect(KEYFRAMES.druk.eyes.left.open).toBe(1);
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

describe("luisterend", () => {
  it("houdt de emotie-achtergrond en kijkt aandachtiger dan wakker (grotere ogen, opgetrokken wenkbrauwen)", () => {
    const awake = frameForDisplay("wakker", "blij", 0.5);
    const listening = frameForDisplay("luisterend", "blij", 0.5);
    expect(listening.background).toBe(awake.background);
    expect(listening.mouth).toEqual(awake.mouth);
    expect(listening.eyes.left.scale).toBeGreaterThan(awake.eyes.left.scale);
    expect(listening.eyes.right.scale).toBeGreaterThan(awake.eyes.right.scale);
    expect(listening.brow!.raise).toBeGreaterThan(awake.brow!.raise);
  });
});

describe("spreekt", () => {
  it("toont het emotieframe (de mond wordt door het volume gestuurd, niet door het frame)", () => {
    expect(frameForDisplay("spreekt", "blij", 0.5)).toEqual(frameForDisplay("wakker", "blij", 0.5));
  });
});
