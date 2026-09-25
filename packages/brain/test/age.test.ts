import { describe, expect, it } from "vitest";
import { ageLabel } from "../src/age.js";

const born = "2026-01-01T00:00:00.000Z";
const after = (days: number) => new Date(Date.parse(born) + days * 86_400_000).toISOString();

describe("ageLabel", () => {
  it("toont dagen, enkelvoud bij één", () => {
    expect(ageLabel(born, after(1))).toBe("1 dag oud");
    expect(ageLabel(born, after(12))).toBe("12 dagen oud");
  });
  it("toont minder dan een dag als 'minder dan een dag oud'", () => {
    expect(ageLabel(born, after(0.5))).toBe("minder dan een dag oud");
  });
  it("toont jaren vanaf 365 dagen", () => {
    expect(ageLabel(born, after(364))).toBe("364 dagen oud");
    expect(ageLabel(born, after(365))).toBe("1 jaar oud");
    expect(ageLabel(born, after(800))).toBe("2 jaar oud");
  });
});
