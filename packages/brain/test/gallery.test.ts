import { describe, expect, it } from "vitest";
import { justWoken, parseCommand, parseGalleryMessage, screenFor, selectionLost } from "../src/gallery.js";

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

describe("parseGalleryMessage", () => {
  const beings = [{ id: 1, name: "Anna", awake: false, bornAt: "2026-01-01T00:00:00.000Z" }];
  const grave = { id: 4, name: "Bo", bornAt: "2026-01-01T00:00:00.000Z", deletedAt: "2026-02-01T00:00:00.000Z", farewell: "Dag." };

  it("leest beings en graves", () => {
    expect(parseGalleryMessage({ beings, graves: [grave] })).toEqual({ beings, graves: [grave] });
  });

  it("valt terug op lege graves bij een ouder bericht zonder graves", () => {
    expect(parseGalleryMessage({ beings })).toEqual({ beings, graves: [] });
    expect(parseGalleryMessage({ beings, graves: "x" })).toEqual({ beings, graves: [] });
  });

  it("slaat ongeldige graven over en laat extra velden weg", () => {
    expect(parseGalleryMessage({ beings, graves: [grave, { id: 5 }, null, { ...grave, id: 6, extra: 1 }] })?.graves).toEqual([grave, { ...grave, id: 6 }]);
  });

  it("geeft null bij ongeldige beings of rommel", () => {
    for (const bad of [null, 3, {}, { beings: "x" }, { beings: [{ id: "1" }] }, { beings: [{ id: 1, name: "Anna", awake: false }] }]) expect(parseGalleryMessage(bad)).toBeNull();
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
