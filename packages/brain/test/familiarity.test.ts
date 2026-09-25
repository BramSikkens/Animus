import { describe, expect, it } from "vitest";
import { familiarityStyle, parseFamiliarity, updateFamiliarity } from "../src/familiarity.js";
import type { Axes } from "../src/personality.js";

const axes = (tf: number, expressiveness: number): Axes => ({ ie: 0.5, sn: 0.5, tf, jp: 0.5, reactivity: 0.5, expressiveness });
const neutral = axes(0.5, 0.5);

describe("updateFamiliarity: beurt", () => {
  it("laat Vertrouwdheid een klein beetje stijgen", () => {
    const next = updateFamiliarity({ current: 0.2, event: "beurt", axes: neutral });
    expect(next).toBeGreaterThan(0.2);
    expect(next).toBeLessThan(0.25);
  });

  it("groeit asymptotisch: dichter bij 1 is de stap kleiner, en 1 wordt nooit overschreden", () => {
    const low = updateFamiliarity({ current: 0.2, event: "beurt", axes: neutral }) - 0.2;
    const high = updateFamiliarity({ current: 0.9, event: "beurt", axes: neutral }) - 0.9;
    expect(high).toBeLessThan(low);
    expect(updateFamiliarity({ current: 1, event: "beurt", axes: neutral })).toBe(1);
  });

  it("groeit sneller bij hoge F en hoge expressiviteit dan bij lage", () => {
    const warm = updateFamiliarity({ current: 0.2, event: "beurt", axes: axes(1, 1) });
    const cool = updateFamiliarity({ current: 0.2, event: "beurt", axes: axes(0, 0) });
    expect(warm).toBeGreaterThan(cool);
  });
});

describe("updateFamiliarity: positief", () => {
  it("geeft meer groei dan een gewone beurt, ook asymptotisch", () => {
    const turn = updateFamiliarity({ current: 0.5, event: "beurt", axes: neutral });
    const positive = updateFamiliarity({ current: 0.5, event: "positief", axes: neutral });
    expect(positive).toBeGreaterThan(turn);
    expect(updateFamiliarity({ current: 1, event: "positief", axes: neutral })).toBe(1);
  });
});

describe("updateFamiliarity: dalende events", () => {
  it("negeren en lange stilte laten Vertrouwdheid dalen, lange stilte harder", () => {
    const ignored = updateFamiliarity({ current: 0.5, event: "genegeerd", axes: neutral });
    const silence = updateFamiliarity({ current: 0.5, event: "langeStilte", axes: neutral });
    expect(ignored).toBeLessThan(0.5);
    expect(silence).toBeLessThan(ignored);
  });

  it("zakt niet onder 0.05, en trekt een lagere waarde ook niet omhoog", () => {
    expect(updateFamiliarity({ current: 0.06, event: "langeStilte", axes: neutral })).toBe(0.05);
    expect(updateFamiliarity({ current: 0.05, event: "genegeerd", axes: neutral })).toBe(0.05);
    expect(updateFamiliarity({ current: 0, event: "genegeerd", axes: neutral })).toBe(0);
  });
});

describe("familiarityStyle", () => {
  it.each([
    [0, "afstandelijk"],
    [0.2, "afstandelijk"],
    [0.3, "vriendelijk"],
    [0.54, "vriendelijk"],
    [0.55, "vertrouwd"],
    [0.79, "vertrouwd"],
    [0.8, "intiem"],
    [1, "intiem"],
  ] as const)("%s valt in band %s", (value, band) => {
    expect(familiarityStyle(value).band).toBe(band);
  });

  it("geeft per band een eigen Nederlandse instructie", () => {
    const [far, friendly, close, intimate] = [0.1, 0.4, 0.7, 0.9].map((v) => familiarityStyle(v).instruction);
    expect(new Set([far, friendly, close, intimate]).size).toBe(4);
    expect(far).toMatch(/beleefd|formeel/i);
    expect(far).toMatch(/\bu\b/);
    expect(far).toMatch(/geen bijnamen/i);
    expect(close).toMatch(/grapjes/i);
    expect(close).toMatch(/eerdere gesprekken/i);
    expect(intimate).toMatch(/bijnamen/i);
    expect(intimate).toMatch(/plaag/i);
  });
});

describe("parseFamiliarity", () => {
  const field = (value: unknown) => (name: string) => (name === "familiarity" ? value : undefined);

  it("leest veld `familiarity` en clampt naar 0–1", () => {
    expect(parseFamiliarity(field("0.65"))).toBe(0.65);
    expect(parseFamiliarity(field("1.5"))).toBe(1);
    expect(parseFamiliarity(field("-1"))).toBe(0);
  });

  it("geeft null bij ontbrekend, leeg of geen getal", () => {
    expect(parseFamiliarity(field(undefined))).toBeNull();
    expect(parseFamiliarity(field("  "))).toBeNull();
    expect(parseFamiliarity(field("abc"))).toBeNull();
    expect(parseFamiliarity(field(new File([], "x")))).toBeNull();
  });
});
