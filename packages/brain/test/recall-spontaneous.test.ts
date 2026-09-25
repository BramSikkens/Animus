import { describe, expect, it } from "vitest";
import {
  pickSpontaneousMemory,
  SPONTANEOUS_COOLDOWN_MS,
  SPONTANEOUS_MIN_AGE_MS,
  spontaneousChance,
  type SpontaneousCandidate,
} from "../src/recall-spontaneous.js";

const now = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const axes = { ie: 0.5, sn: 0.5, tf: 0.5, jp: 0.5, reactivity: 0.5, expressiveness: 0.5 };

const memory = (id: number, over: Partial<SpontaneousCandidate> = {}): SpontaneousCandidate => ({
  id,
  createdAt: new Date(now.getTime() - 3 * DAY),
  impression: 0.8,
  lastRecalledAt: null,
  text: `herinnering ${id}`,
  ...over,
});

const pick = (memories: SpontaneousCandidate[], over: Partial<Parameters<typeof pickSpontaneousMemory>[0]> = {}) =>
  pickSpontaneousMemory({ memories, now, axes, rng: () => 0, ...over });

describe("pickSpontaneousMemory", () => {
  it("geeft null bij een lege lijst", () => {
    expect(pick([])).toBeNull();
  });

  it("kiest een geschikte herinnering", () => {
    expect(pick([memory(1)])?.id).toBe(1);
  });

  it("slaat te jonge herinneringen over", () => {
    expect(pick([memory(1, { createdAt: new Date(now.getTime() - SPONTANEOUS_MIN_AGE_MS + 1000) })])).toBeNull();
  });

  it("slaat een lage Indruk over", () => {
    expect(pick([memory(1, { impression: 0.3 })])).toBeNull();
  });

  it("slaat herinneringen in cooldown over, en laat ze na de cooldown weer toe", () => {
    const recent = new Date(now.getTime() - SPONTANEOUS_COOLDOWN_MS + 1000);
    const old = new Date(now.getTime() - SPONTANEOUS_COOLDOWN_MS - 1000);
    expect(pick([memory(1, { lastRecalledAt: recent })])).toBeNull();
    expect(pick([memory(1, { lastRecalledAt: old })])?.id).toBe(1);
  });

  it("kiest gewogen op Indruk x ouderdom met de rng", () => {
    const list = [memory(1, { impression: 0.5 }), memory(2, { impression: 1 })];
    // eerste rng-call = kansworp (laag = aanhalen), tweede = de keuze
    const seq = (a: number, b: number) => {
      const values = [a, b];
      return () => values.shift() ?? 0;
    };
    expect(pick(list, { rng: seq(0, 0) })?.id).toBe(1);
    expect(pick(list, { rng: seq(0, 0.99) })?.id).toBe(2);
  });

  it("weegt oudere herinneringen zwaarder", () => {
    const young = memory(1, { createdAt: new Date(now.getTime() - 2 * DAY) });
    const old = memory(2, { createdAt: new Date(now.getTime() - 20 * DAY) });
    // bij gelijk gewicht zou 0.45 de eerste (jonge) kiezen; oud weegt zwaarder
    const values = [0, 0.45];
    expect(pick([young, old], { rng: () => values.shift() ?? 0 })?.id).toBe(2);
  });

  it("geeft null als de kansworp faalt", () => {
    expect(pick([memory(1)], { rng: () => 0.999 })).toBeNull();
  });
});

describe("spontaneousChance", () => {
  it("is hoger voor F dan voor T", () => {
    expect(spontaneousChance({ ...axes, tf: 1 })).toBeGreaterThan(spontaneousChance({ ...axes, tf: 0 }));
  });

  it("is hoger bij meer expressiviteit", () => {
    expect(spontaneousChance({ ...axes, expressiveness: 1 })).toBeGreaterThan(spontaneousChance({ ...axes, expressiveness: 0 }));
  });

  it("schaalt met de basiskans en blijft in 0..1", () => {
    expect(spontaneousChance(axes, 0.01)).toBeLessThan(spontaneousChance(axes, 0.5));
    expect(spontaneousChance({ ...axes, tf: 1, expressiveness: 1 }, 5)).toBe(1);
  });
});
