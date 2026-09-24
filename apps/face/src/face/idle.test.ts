import { describe, expect, it } from "vitest";
import { IDLE_AMPLITUDE, idleOffsets } from "./idle.js";

const KEYS = ["breathY", "pupilX", "pupilY", "browRaise"] as const;

function scan(from: number, to: number, step: number): number[] {
  const ts: number[] = [];
  for (let t = from; t <= to; t += step) ts.push(t);
  return ts;
}

describe("idleOffsets", () => {
  it("is bepaald: dezelfde t geeft dezelfde uitvoer", () => {
    expect(idleOffsets(12.345)).toEqual(idleOffsets(12.345));
  });

  it("blijft binnen de amplitudes over 120 seconden", () => {
    for (const t of scan(0, 120, 0.01)) {
      const o = idleOffsets(t);
      for (const k of KEYS) expect(Math.abs(o[k])).toBeLessThanOrEqual(IDLE_AMPLITUDE[k] + 1e-9);
      expect(Math.abs(o.breathScale - 1)).toBeLessThanOrEqual(IDLE_AMPLITUDE.breathScale + 1e-9);
    }
  });

  it("blink ligt altijd in [0,1]", () => {
    for (const t of scan(0, 120, 0.01)) {
      const { blink } = idleOffsets(t);
      expect(blink).toBeGreaterThanOrEqual(0);
      expect(blink).toBeLessThanOrEqual(1);
    }
  });

  it("blink dipt periodiek naar een lage waarde en is anders precies 1", () => {
    const values = scan(0, 20, 0.01).map((t) => idleOffsets(t).blink);
    expect(Math.min(...values)).toBeLessThan(0.2);
    const open = values.filter((v) => v === 1).length;
    expect(open / values.length).toBeGreaterThan(0.9);
  });

  it("knippert meerdere keren in 20 seconden, ruwweg elke 3-5 seconde", () => {
    const blinking = scan(0, 20, 0.01).map((t) => idleOffsets(t).blink < 1);
    const starts = blinking.filter((b, i) => b && !blinking[i - 1]).length;
    expect(starts).toBeGreaterThanOrEqual(3);
    expect(starts).toBeLessThanOrEqual(7);
  });

  it("beweegt echt: geen constante waarden over een venster van 10 seconden", () => {
    const os = scan(0, 10, 0.05).map(idleOffsets);
    for (const k of [...KEYS, "breathScale"] as const) {
      const vals = os.map((o) => o[k]);
      expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.01);
    }
  });
});
