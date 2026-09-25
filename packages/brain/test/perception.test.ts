import { describe, expect, it } from "vitest";
import { isWaarneming } from "../src/perception.js";

describe("isWaarneming", () => {
  it("accepteert aanwezig", () => {
    expect(isWaarneming({ soort: "aanwezig" })).toBe(true);
  });

  it("accepteert afwezig", () => {
    expect(isWaarneming({ soort: "afwezig" })).toBe(true);
  });

  it("accepteert nieuw-object met een geldig COCO-label", () => {
    expect(isWaarneming({ soort: "nieuw-object", object: "cat" })).toBe(true);
    expect(isWaarneming({ soort: "nieuw-object", object: "potted plant" })).toBe(true);
  });

  it("verwerpt nieuw-object met een ongeldig label", () => {
    expect(isWaarneming({ soort: "nieuw-object", object: "Cat" })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object", object: "cat123" })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object", object: "" })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object", object: 1 })).toBe(false);
    expect(isWaarneming({ soort: "nieuw-object" })).toBe(false);
  });

  it("verwerpt onbekende vormen", () => {
    expect(isWaarneming(null)).toBe(false);
    expect(isWaarneming(undefined)).toBe(false);
    expect(isWaarneming("aanwezig")).toBe(false);
    expect(isWaarneming({ soort: "onbekend" })).toBe(false);
  });
});
