import { describe, expect, it } from "vitest";
import { decideGesprekspartner } from "./gesprekspartner.js";

describe("decideGesprekspartner", () => {
  it("een zekere stem geeft die Persoon", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: true } })).toBe(7);
  });

  it("een onzekere stem geeft onbekend (null)", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: false } })).toBeNull();
  });

  it("geen stemresultaat geeft onbekend (null)", () => {
    expect(decideGesprekspartner({ voice: null })).toBeNull();
  });
});
