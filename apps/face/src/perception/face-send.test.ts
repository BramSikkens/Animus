import { describe, expect, it } from "vitest";
import { createFaceSendRule } from "./face-send.js";

describe("createFaceSendRule", () => {
  it("verzendt niets zonder gezichten", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    expect(rule.update(0, 0)).toBe(false);
    expect(rule.update(0, 5000)).toBe(false);
  });

  it("verzendt bij verschijnen (0 → ≥1)", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    expect(rule.update(1, 0)).toBe(true);
  });

  it("verzendt niet opnieuw binnen het interval", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    rule.update(1, 0);
    expect(rule.update(1, 1000)).toBe(false);
    expect(rule.update(1, 2999)).toBe(false);
  });

  it("verzendt weer na afloop van het interval, zolang er gezichten zijn", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    rule.update(1, 0);
    expect(rule.update(1, 3000)).toBe(true);
    expect(rule.update(2, 3500)).toBe(false);
    expect(rule.update(1, 6000)).toBe(true);
  });

  it("een gemist frame (< 1500ms zonder gezichten) telt niet als nieuwe verschijning: het interval loopt door", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    expect(rule.update(1, 0)).toBe(true); // verschijnt
    expect(rule.update(0, 500)).toBe(false); // flikkert kort weg
    expect(rule.update(1, 600)).toBe(false); // terug binnen de debounce: geen nieuwe verschijning
    expect(rule.update(1, 2999)).toBe(false); // het oorspronkelijke interval (sinds t=0) liep gewoon door
    expect(rule.update(1, 3000)).toBe(true); // interval verstreken
  });

  it("meerdere korte flikkeringen na elkaar geven geen extra sends", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    rule.update(1, 0);
    expect(rule.update(0, 100)).toBe(false);
    expect(rule.update(1, 200)).toBe(false);
    expect(rule.update(0, 800)).toBe(false);
    expect(rule.update(1, 900)).toBe(false);
    expect(rule.update(1, 3000)).toBe(true);
  });

  it("een onderbreking van ≥ 1500ms telt wél als verdwenen: de terugkomst is een nieuwe verschijning", () => {
    const rule = createFaceSendRule({ intervalMs: 3000 });
    rule.update(1, 0); // verschijnt
    expect(rule.update(0, 100)).toBe(false); // gap begint
    expect(rule.update(0, 1599)).toBe(false); // net geen 1500ms sinds de gap
    expect(rule.update(1, 1600)).toBe(true); // 1500ms zonder gezichten: telt als verdwenen, dus nieuwe verschijning
  });

  it("default interval is 3000ms zonder opties", () => {
    const rule = createFaceSendRule();
    rule.update(1, 0);
    expect(rule.update(1, 2999)).toBe(false);
    expect(rule.update(1, 3000)).toBe(true);
  });
});
