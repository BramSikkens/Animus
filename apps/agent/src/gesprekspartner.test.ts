import { describe, expect, it } from "vitest";
import { decideGesprekspartner } from "./gesprekspartner.js";

describe("decideGesprekspartner", () => {
  it("een zekere stem geeft die Persoon", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: true }, perceptionActive: true })).toEqual({ soort: "persoon", personId: 7 });
  });

  it("een zekere stem geeft die Persoon, ook zonder actieve perceptie (stem wint sowieso)", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: true }, perceptionActive: false })).toEqual({ soort: "persoon", personId: 7 });
  });

  it("onzekere stem zonder gezicht, perceptie actief: onbekend", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: false }, perceptionActive: true })).toEqual({ soort: "onbekend" });
  });

  it("geen stemresultaat, perceptie actief: onbekend", () => {
    expect(decideGesprekspartner({ voice: null, perceptionActive: true })).toEqual({ soort: "onbekend" });
  });

  it("geen stemresultaat en geen perceptie actief: geen-signaal", () => {
    expect(decideGesprekspartner({ voice: null, perceptionActive: false })).toEqual({ soort: "geen-signaal" });
  });

  it("stem onzeker + precies één bekend gezicht in beeld: dat gezicht", () => {
    expect(decideGesprekspartner({ voice: null, faces: [3], perceptionActive: true })).toEqual({ soort: "persoon", personId: 3 });
  });

  it("stem onzeker + twee gezichten in beeld, perceptie actief: onbekend", () => {
    expect(decideGesprekspartner({ voice: null, faces: [3, 4], perceptionActive: true })).toEqual({ soort: "onbekend" });
  });

  it("stem onzeker + één onbekend gezicht in beeld, perceptie actief: onbekend", () => {
    expect(decideGesprekspartner({ voice: null, faces: [null], perceptionActive: true })).toEqual({ soort: "onbekend" });
  });

  it("stem onzeker + geen gezicht in beeld, geen perceptie actief: geen-signaal", () => {
    expect(decideGesprekspartner({ voice: null, faces: [], perceptionActive: false })).toEqual({ soort: "geen-signaal" });
  });

  it("een zekere stem wint van een gezicht", () => {
    expect(decideGesprekspartner({ voice: { personId: 7, sure: true }, faces: [3], perceptionActive: true })).toEqual({ soort: "persoon", personId: 7 });
  });
});
