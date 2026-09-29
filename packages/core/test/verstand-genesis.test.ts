import { describe, expect, it } from "vitest";
import { rollVerstand } from "../src/verstand.js";

// Reeks van vaste waarden voor een ingespoten rng, in aanroepvolgorde.
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

describe("rollVerstand", () => {
  it("rolt richtwaarde ± spreiding bij een normale worp (buiten de 5%-kans)", () => {
    // eerste rng() = 0.5 (>= 0.05, dus geen wilde worp), tweede rng() = 0.5 → geen afwijking (0.5*2-1 = 0)
    expect(rollVerstand(0.7, seq([0.5, 0.5]))).toBeCloseTo(0.7);
    // tweede rng() = 1 → +0.3
    expect(rollVerstand(0.5, seq([0.5, 1]))).toBeCloseTo(0.8);
    // tweede rng() = 0 → -0.3
    expect(rollVerstand(0.5, seq([0.5, 0]))).toBeCloseTo(0.2);
  });

  it("geeft een volledig willekeurige waarde bij de 5%-worp", () => {
    expect(rollVerstand(0.85, seq([0.049, 0.42]))).toBeCloseTo(0.42);
  });

  it("klemt op 0..1", () => {
    // richtwaarde 0.85 + volle spreiding (+0.3) zou boven 1 komen
    expect(rollVerstand(0.85, seq([0.5, 1]))).toBe(1);
    // richtwaarde 0.15 - volle spreiding (-0.3) zou onder 0 komen
    expect(rollVerstand(0.15, seq([0.5, 0]))).toBe(0);
  });
});
