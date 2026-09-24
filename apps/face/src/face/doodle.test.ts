import { describe, expect, it } from "vitest";
import { doodleActive, doodlePath } from "./doodle.js";

describe("doodleActive", () => {
  it("is actief zodra de stilte de drempel haalt", () => {
    expect(doodleActive({ idleMs: 1000, thresholdMs: 1000, display: "wakker" })).toBe(true);
    expect(doodleActive({ idleMs: 999, thresholdMs: 1000, display: "wakker" })).toBe(false);
  });

  it("wijkt voor reflecterend", () => {
    expect(doodleActive({ idleMs: 5000, thresholdMs: 1000, display: "reflecterend" })).toBe(false);
  });

  it("laat slapend het slaapgezicht houden", () => {
    expect(doodleActive({ idleMs: 5000, thresholdMs: 1000, display: "slapend" })).toBe(false);
  });
});

describe("doodlePath", () => {
  const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

  it("is bepaald in t en seed", () => {
    expect(doodlePath(12.5, 3)).toBe(doodlePath(12.5, 3));
    expect(doodlePath(12.5, 3)).not.toBe(doodlePath(12.5, 4));
  });

  it("blijft binnen de viewBox 0..200", () => {
    for (let t = 0; t < 600; t += 0.7) for (const n of nums(doodlePath(t, 1))) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(200);
    }
  });

  it("beweegt over tijd", () => {
    expect(doodlePath(0, 1)).not.toBe(doodlePath(5, 1));
  });
});
