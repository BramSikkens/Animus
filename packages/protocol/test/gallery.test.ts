import { describe, expect, it } from "vitest";
import { parseCommand, parseGalleryMessage } from "../src/gallery.js";

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
