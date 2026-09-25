import { describe, expect, it } from "vitest";
import { decideGesprekspartner, shouldOverrideGesprekspartner } from "./gesprekspartner.js";

describe("decideGesprekspartner", () => {
  it("een zekere stem geeft die Persoon", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: true } })).toBe(7);
  });

  it("een onzekere stem geeft onbekend (null) zonder gezichten", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: false } })).toBeNull();
  });

  it("geen stemresultaat geeft onbekend (null) zonder gezichten", () => {
    expect(decideGesprekspartner({ voice: null })).toBeNull();
  });

  it("stem onzeker + precies één bekend gezicht in beeld: dat gezicht", () => {
    expect(decideGesprekspartner({ voice: null, faces: [3] })).toBe(3);
  });

  it("stem onzeker + twee gezichten in beeld: onbekend (null)", () => {
    expect(decideGesprekspartner({ voice: null, faces: [3, 4] })).toBeNull();
  });

  it("stem onzeker + één onbekend gezicht in beeld: onbekend (null)", () => {
    expect(decideGesprekspartner({ voice: null, faces: [null] })).toBeNull();
  });

  it("stem onzeker + geen gezicht in beeld: onbekend (null)", () => {
    expect(decideGesprekspartner({ voice: null, faces: [] })).toBeNull();
  });

  it("een zekere stem wint van een gezicht", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: true }, faces: [3] })).toBe(7);
  });
});

describe("shouldOverrideGesprekspartner", () => {
  it("geen stemherkenning en geen gezicht: weglaten (false)", () => {
    expect(shouldOverrideGesprekspartner({ hasSpeaker: false, faces: [] })).toBe(false);
  });

  it("stemherkenning actief, ook zonder gezicht: overschrijven (true)", () => {
    expect(shouldOverrideGesprekspartner({ hasSpeaker: true, faces: [] })).toBe(true);
  });

  it("geen stemherkenning maar wel een gezicht in beeld: overschrijven (true)", () => {
    expect(shouldOverrideGesprekspartner({ hasSpeaker: false, faces: [null] })).toBe(true);
  });
});
