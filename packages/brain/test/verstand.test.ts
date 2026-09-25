import { describe, expect, it } from "vitest";
import { growVerstand, parseVerstand, verstandBand } from "../src/verstand.js";

describe("verstandBand", () => {
  it.each([
    [0, "sterk-laag"],
    [0.24, "sterk-laag"],
    [0.25, "laag"],
    [0.39, "laag"],
    [0.4, "midden"],
    [0.6, "midden"],
    [0.61, "hoog"],
    [0.75, "hoog"],
    [0.76, "sterk-hoog"],
    [1, "sterk-hoog"],
    [null, "midden"],
  ] as const)("%s valt in band %s", (value, band) => {
    expect(verstandBand(value)).toBe(band);
  });
});

describe("growVerstand", () => {
  it("groeit hoogstens +0.02", () => {
    expect(growVerstand(0.5, 0.02)).toBeCloseTo(0.52);
    expect(growVerstand(0.5, 1)).toBeCloseTo(0.52);
  });

  it("laat een negatieve verschuiving ongemoeid", () => {
    expect(growVerstand(0.5, -0.3)).toBe(0.5);
  });

  it("klemt op bovengrens 1", () => {
    expect(growVerstand(0.99, 0.02)).toBe(1);
  });

  it("laat een leeg Verstand leeg", () => {
    expect(growVerstand(null, 0.02)).toBeNull();
  });
});

describe("parseVerstand", () => {
  const field = (value: FormDataEntryValue | null) => (name: string) => (name === "verstand" ? value : null);

  it("leest veld `verstand` en clampt naar 0–1", () => {
    expect(parseVerstand(field("0.65"))).toBe(0.65);
    expect(parseVerstand(field("1.5"))).toBe(1);
    expect(parseVerstand(field("-1"))).toBe(0);
  });

  it("geeft null bij ontbrekend, leeg of geen getal", () => {
    expect(parseVerstand(field(null))).toBeNull();
    expect(parseVerstand(field("  "))).toBeNull();
    expect(parseVerstand(field("abc"))).toBeNull();
    expect(parseVerstand(field(new File([], "x")))).toBeNull();
  });
});
