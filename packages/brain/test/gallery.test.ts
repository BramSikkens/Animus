import { describe, expect, it } from "vitest";
import { parseCommand, screenFor, selectionLost } from "../src/gallery.js";

describe("parseCommand", () => {
  it("accepteert wake en sleep met een integer id", () => {
    expect(parseCommand({ type: "wake", id: 3 })).toEqual({ type: "wake", id: 3 });
    expect(parseCommand({ type: "sleep", id: 1 })).toEqual({ type: "sleep", id: 1 });
  });

  it("weigert onbekende types, niet-integer ids en rommel; extra velden worden weggelaten", () => {
    for (const bad of [null, undefined, "wake", 5, [], {}, { type: "kill", id: 1 }, { type: "wake" }, { type: "wake", id: "1" }, { type: "wake", id: 1.5 }, { type: "wake", id: NaN }, { type: "wake", id: Infinity }]) {
      expect(parseCommand(bad)).toBeNull();
    }
    expect(parseCommand({ type: "wake", id: 2, extra: "x" })).toEqual({ type: "wake", id: 2 });
  });
});

describe("screenFor", () => {
  const a = { id: 1, name: "Anna", awake: false };
  const b = { id: 2, name: "Bo", awake: true };

  it("toont laden zolang er geen verbinding of lijst is", () => {
    expect(screenFor({ connected: false, beings: [a], selectedId: null })).toEqual({ screen: "laden" });
    expect(screenFor({ connected: true, beings: null, selectedId: null })).toEqual({ screen: "laden" });
  });

  it("toont de galerij zolang niets gekozen is, ook als er iemand wakker is of de lijst leeg is", () => {
    expect(screenFor({ connected: true, beings: [a, b], selectedId: null })).toEqual({ screen: "galerij", beings: [a, b] });
    expect(screenFor({ connected: true, beings: [], selectedId: null })).toEqual({ screen: "galerij", beings: [] });
  });

  it("toont wakker-worden tot de gekozen Dynimo als wakker gepubliceerd is, daarna zijn gezicht", () => {
    expect(screenFor({ connected: true, beings: [a, b], selectedId: 1 })).toEqual({ screen: "wakker-worden", being: a });
    expect(screenFor({ connected: true, beings: [a, b], selectedId: 2 })).toEqual({ screen: "gezicht", being: b });
  });

  it("valt terug op de galerij als de gekozen Dynimo niet (meer) bestaat", () => {
    expect(screenFor({ connected: true, beings: [a], selectedId: 9 })).toEqual({ screen: "galerij", beings: [a] });
  });
});

describe("selectionLost", () => {
  const asleep = { id: 1, name: "Anna", awake: false };
  const awake = { id: 1, name: "Anna", awake: true };

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
