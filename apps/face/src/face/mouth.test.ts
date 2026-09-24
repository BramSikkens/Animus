import { describe, expect, it } from "vitest";
import { mouthOpenForVolume } from "./mouth.js";

describe("mouthOpenForVolume", () => {
  it("stilte houdt de mond dicht", () => {
    expect(mouthOpenForVolume(0)).toBe(0);
  });

  it("wordt groter naarmate het volume stijgt, tot verzadiging op 1", () => {
    expect(mouthOpenForVolume(0.1)).toBeGreaterThan(0);
    expect(mouthOpenForVolume(0.2)).toBeGreaterThan(mouthOpenForVolume(0.1));
    expect(mouthOpenForVolume(1)).toBe(1);
  });

  it("klemt naar [0, 1] en negeert ongeldige waarden", () => {
    expect(mouthOpenForVolume(-0.5)).toBe(0);
    expect(mouthOpenForVolume(5)).toBe(1);
    expect(mouthOpenForVolume(Number.NaN)).toBe(0);
  });
});
