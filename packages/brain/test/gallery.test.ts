import { describe, expect, it } from "vitest";
import { galleryView, parseCommand } from "../src/gallery.js";

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

describe("galleryView", () => {
  const a = { id: 1, name: "Anna", awake: false };
  const b = { id: 2, name: "Bo", awake: true };

  it("toont niets (laden) zolang de lijst onbekend is", () => {
    expect(galleryView(null)).toEqual({ screen: "laden" });
  });

  it("toont de galerij als niemand wakker is, ook leeg", () => {
    expect(galleryView([a])).toEqual({ screen: "galerij", beings: [a] });
    expect(galleryView([])).toEqual({ screen: "galerij", beings: [] });
  });

  it("toont enkel het gezicht van de wakkere Dynimo", () => {
    expect(galleryView([a, b])).toEqual({ screen: "gezicht", awake: b });
  });
});
