import { describe, expect, it } from "vitest";
import { justWoken, screenFor, selectionLost } from "./gallery-screen.js";

describe("screenFor", () => {
  const a = { id: 1, name: "Anna", awake: false, bornAt: "2026-01-01T00:00:00.000Z" };
  const b = { id: 2, name: "Bo", awake: true, bornAt: "2026-01-01T00:00:00.000Z" };

  it("toont laden zolang er geen verbinding of lijst is", () => {
    expect(screenFor({ connected: false, beings: [a], selectedId: null })).toEqual({ screen: "laden" });
    expect(screenFor({ connected: true, beings: null, selectedId: null })).toEqual({ screen: "laden" });
  });

  it("toont de galerij zolang niets gekozen is, ook als er iemand wakker is of de lijst leeg is", () => {
    expect(screenFor({ connected: true, beings: [a, b], selectedId: null })).toEqual({ screen: "galerij", beings: [a, b], graves: [] });
    expect(screenFor({ connected: true, beings: [], selectedId: null })).toEqual({ screen: "galerij", beings: [], graves: [] });
  });

  it("toont wakker-worden tot de gekozen Dynimo als wakker gepubliceerd is, daarna zijn gezicht", () => {
    expect(screenFor({ connected: true, beings: [a, b], selectedId: 1 })).toEqual({ screen: "wakker-worden", being: a });
    expect(screenFor({ connected: true, beings: [a, b], selectedId: 2 })).toEqual({ screen: "gezicht", being: b });
  });

  it("valt terug op de galerij als de gekozen Dynimo niet (meer) bestaat", () => {
    expect(screenFor({ connected: true, beings: [a], selectedId: 9 })).toEqual({ screen: "galerij", beings: [a], graves: [] });
  });
});

describe("selectionLost", () => {
  const asleep = { id: 1, name: "Anna", awake: false, bornAt: "2026-01-01T00:00:00.000Z" };
  const awake = { id: 1, name: "Anna", awake: true, bornAt: "2026-01-01T00:00:00.000Z" };

  it("is waar als de gekozen Dynimo wakker was en nu slaapt of verdwenen is", () => {
    expect(selectionLost({ selectedId: 1, beings: [asleep], sawAwake: true })).toBe(true);
    expect(selectionLost({ selectedId: 1, beings: [], sawAwake: true })).toBe(true);
  });

  it("is onwaar tijdens het wakker worden, terwijl hij wakker is, of zonder keuze", () => {
    expect(selectionLost({ selectedId: 1, beings: [asleep], sawAwake: false })).toBe(false);
    expect(selectionLost({ selectedId: 1, beings: [awake], sawAwake: true })).toBe(false);
    expect(selectionLost({ selectedId: null, beings: [asleep], sawAwake: true })).toBe(false);
  });
});

describe("screenFor met graven", () => {
  const grave = { id: 4, name: "Bo", bornAt: "2026-01-01T00:00:00.000Z", deletedAt: "2026-02-01T00:00:00.000Z", farewell: "Dag." };
  it("geeft de graven mee aan de galerij, standaard leeg", () => {
    expect(screenFor({ connected: true, beings: [], graves: [grave], selectedId: null })).toEqual({ screen: "galerij", beings: [], graves: [grave] });
    expect(screenFor({ connected: true, beings: [], selectedId: null })).toEqual({ screen: "galerij", beings: [], graves: [] });
  });
});

describe("justWoken", () => {
  const born = "2026-01-01T00:00:00.000Z";
  const anna = (awake: boolean) => ({ id: 1, name: "Anna", awake, bornAt: born });

  it("geeft de id van een bestaande Dynimo die van slapend naar wakker ging", () => {
    expect(justWoken({ before: [anna(false)], after: [anna(true)] })).toBe(1);
  });

  it("geeft null zonder vorige lijst, als niemand wakker werd, of voor een pasgeborene", () => {
    expect(justWoken({ before: null, after: [anna(true)] })).toBeNull();
    expect(justWoken({ before: [anna(true)], after: [anna(true)] })).toBeNull();
    expect(justWoken({ before: [anna(true)], after: [anna(false)] })).toBeNull();
    expect(justWoken({ before: [], after: [anna(true)] })).toBeNull();
  });
});
