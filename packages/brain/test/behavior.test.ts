import { describe, expect, it } from "vitest";
import { decideBehavior, initiativeFactor } from "../src/behavior.js";
import { singleEmotionValues } from "../src/mood.js";
import type { Axes } from "../src/personality.js";

const axes = (overrides: Partial<Axes> = {}): Axes => ({ ie: 0.5, sn: 0.5, tf: 0.5, jp: 0.5, reactivity: 1, expressiveness: 1, ...overrides });
const rng = (value: number) => () => value;

describe("decideBehavior: boos", () => {
  const boos = singleEmotionValues("boos", 0.9);

  it("negeert bij lage rng-worp", () => {
    expect(decideBehavior({ values: boos, axes: axes({ tf: 0 }), rng: rng(0) })).toBe("negeren");
  });

  it("is kortaf bij een worp net boven de negeerkans", () => {
    // reactiviteit 1, tf 0: negeren < 0.6, kort < 0.6 + 0.3
    expect(decideBehavior({ values: boos, axes: axes({ tf: 0 }), rng: rng(0.7) })).toBe("kort");
    expect(decideBehavior({ values: boos, axes: axes({ tf: 0 }), rng: rng(0.95) })).toBe("normaal");
  });

  it("warm (hoge F) verlaagt de kans: dezelfde worp geeft dan geen negeren", () => {
    expect(decideBehavior({ values: boos, axes: axes({ tf: 1 }), rng: rng(0.3) })).not.toBe("negeren");
  });

  it("onder de drempel of niet dominant blijft normaal", () => {
    expect(decideBehavior({ values: singleEmotionValues("boos", 0.6), axes: axes(), rng: rng(0) })).toBe("normaal");
    expect(decideBehavior({ values: { ...boos, blij: 95 }, axes: axes(), rng: rng(0) })).not.toBe("negeren");
  });

  it("een robot (reactiviteit 0) is altijd normaal", () => {
    expect(decideBehavior({ values: boos, axes: axes({ reactivity: 0 }), rng: rng(0) })).toBe("normaal");
  });

  it("negeert nooit twee keer achter elkaar", () => {
    expect(decideBehavior({ values: boos, axes: axes({ tf: 0 }), rng: rng(0), vorigeGenegeerd: true })).toBe("kort");
  });
});

describe("decideBehavior: blij, bang, verveeld", () => {
  it("zeer blij geeft lange antwoorden bij een lage worp", () => {
    const blij = singleEmotionValues("blij", 0.9);
    expect(decideBehavior({ values: blij, axes: axes(), rng: rng(0) })).toBe("lang");
    expect(decideBehavior({ values: blij, axes: axes(), rng: rng(0.99) })).toBe("normaal");
    expect(decideBehavior({ values: singleEmotionValues("blij", 0.6), axes: axes(), rng: rng(0) })).toBe("normaal");
  });

  it("bang en verveeld geven kort", () => {
    expect(decideBehavior({ values: singleEmotionValues("bang", 0.8), axes: axes(), rng: rng(0) })).toBe("kort");
    expect(decideBehavior({ values: singleEmotionValues("verveeld", 0.8), axes: axes(), rng: rng(0) })).toBe("kort");
  });

  it("een robot is bij elke emotie normaal", () => {
    const robot = axes({ reactivity: 0, expressiveness: 0 });
    for (const emotion of ["blij", "boos", "bang", "verveeld"] as const) {
      expect(decideBehavior({ values: singleEmotionValues(emotion, 1), axes: robot, rng: rng(0) })).toBe("normaal");
    }
  });
});

describe("initiativeFactor", () => {
  it("is 1 zonder zeer blij en groter bij zeer blij, geschaald door expressiviteit", () => {
    expect(initiativeFactor(singleEmotionValues("blij", 0.5), axes())).toBe(1);
    expect(initiativeFactor(singleEmotionValues("blij", 0.9), axes())).toBeGreaterThan(1);
    expect(initiativeFactor(singleEmotionValues("blij", 0.9), axes({ expressiveness: 0 }))).toBe(1);
  });
});

describe("decideBehavior: nieuwe emoties", () => {
  it("droevig, vredig en druk worden nooit genegeerd of kort/lang", () => {
    for (const emotion of ["droevig", "vredig", "druk"] as const) {
      const values = singleEmotionValues(emotion, 1);
      for (const roll of [0, 0.5, 0.99]) expect(decideBehavior({ values, axes: axes(), rng: rng(roll) })).toBe("normaal");
      expect(initiativeFactor(values, axes())).toBe(1);
    }
  });
});
