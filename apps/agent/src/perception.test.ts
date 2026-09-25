import { describe, expect, it } from "vitest";
import { createPerception, parseReturnAfterMinutes } from "./perception.js";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createPerception", () => {
  it("is onbekend (dus aanwezig) voordat er een Waarneming binnenkwam", () => {
    const { now } = clock();
    const perception = createPerception({ now, returnAfterMs: 1000 });
    expect(perception.isPresent()).toBe(true);
  });

  it("is afwezig na een afwezig-Waarneming, en geeft geen aanleiding", () => {
    const { now } = clock();
    const perception = createPerception({ now, returnAfterMs: 1000 });
    expect(perception.onWaarneming({ soort: "afwezig" })).toBeNull();
    expect(perception.isPresent()).toBe(false);
  });

  it("geeft geen aanleiding bij terugkomst binnen de drempel", () => {
    const { now, advance } = clock();
    const perception = createPerception({ now, returnAfterMs: 1000 });
    perception.onWaarneming({ soort: "afwezig" });
    advance(999);
    expect(perception.onWaarneming({ soort: "aanwezig" })).toBeNull();
    expect(perception.isPresent()).toBe(true);
  });

  it("geeft de aanleiding 'terug' bij terugkomst na meer dan de drempel", () => {
    const { now, advance } = clock();
    const perception = createPerception({ now, returnAfterMs: 1000 });
    perception.onWaarneming({ soort: "afwezig" });
    advance(1001);
    expect(perception.onWaarneming({ soort: "aanwezig" })).toEqual({ soort: "terug" });
  });

  it("geeft voorlopig niets bij nieuw-object", () => {
    const { now } = clock();
    const perception = createPerception({ now, returnAfterMs: 1000 });
    expect(perception.onWaarneming({ soort: "nieuw-object", object: "cat" })).toBeNull();
  });

  it("reset() zet terug naar onbekend: een afwezigheid die een reset overspant telt niet als terug", () => {
    const { now, advance } = clock();
    const perception = createPerception({ now, returnAfterMs: 1000 });
    perception.onWaarneming({ soort: "afwezig" });
    advance(2000);
    perception.reset();
    expect(perception.isPresent()).toBe(true);
    expect(perception.onWaarneming({ soort: "aanwezig" })).toBeNull();
  });
});

describe("parseReturnAfterMinutes", () => {
  it("valt zonder waarde terug op de default van 10 minuten", () => {
    expect(parseReturnAfterMinutes(undefined)).toEqual({ ms: 10 * 60_000 });
  });

  it("parseert een geldige waarde naar ms", () => {
    expect(parseReturnAfterMinutes("5")).toEqual({ ms: 5 * 60_000 });
  });

  it("waarschuwt en valt terug bij een ongeldige waarde", () => {
    const result = parseReturnAfterMinutes("nope");
    expect(result.ms).toBe(10 * 60_000);
    expect(result.warning).toContain("nope");
  });
});
