import { describe, expect, it } from "vitest";
import { EMOTIONS } from "../src/emotion.js";
import { DREAM_MAX_AGE_MS, DREAM_TELL_CHANCE, pickDreamToTell, type TellableDream } from "../src/dream-tell.js";
import type { MoodValues } from "../src/mood.js";

const now = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const values = (dominant: (typeof EMOTIONS)[number]): MoodValues =>
  Object.fromEntries(EMOTIONS.map((e) => [e, e === dominant ? 60 : 0])) as MoodValues;

const dream = (id: number, over: Partial<TellableDream> = {}): TellableDream => ({
  id,
  createdAt: new Date(now.getTime() - DAY),
  toldAt: null,
  emotion: "kalm",
  intensity: 0.5,
  ...over,
});

const pick = (dreams: TellableDream[], over: Partial<Parameters<typeof pickDreamToTell>[0]> = {}) =>
  pickDreamToTell({ dreams, values: values("nieuwsgierig"), displayState: "wakker", rng: () => 0, now, ...over });

describe("pickDreamToTell", () => {
  it("kiest een ongeziene, recente Droom", () => {
    expect(pick([dream(1)])?.id).toBe(1);
  });

  it("slaat al verteld over", () => {
    expect(pick([dream(1, { toldAt: now })])).toBeNull();
  });

  it("slaat Dromen ouder dan de maximumleeftijd over", () => {
    expect(pick([dream(1, { createdAt: new Date(now.getTime() - DREAM_MAX_AGE_MS - 1) })])).toBeNull();
  });

  it("kiest de nieuwste van meerdere", () => {
    const older = dream(1, { createdAt: new Date(now.getTime() - 3 * DAY) });
    expect(pick([older, dream(2)])?.id).toBe(2);
  });

  it("nooit tijdens luisterend of spreekt", () => {
    expect(pick([dream(1)], { displayState: "luisterend" })).toBeNull();
    expect(pick([dream(1)], { displayState: "spreekt" })).toBeNull();
  });

  it("geeft null zonder Dromen", () => {
    expect(pick([])).toBeNull();
  });

  it("kans hoger bij verveeld/kalm/vredig, lager bij boos/druk", () => {
    // rng net boven de basiskans: nieuwsgierig (geen factor) mist, kalm haalt het, boos haalt het niet
    const rng = () => DREAM_TELL_CHANCE + 0.01;
    expect(pick([dream(1)], { values: values("nieuwsgierig"), rng })).toBeNull();
    for (const e of ["verveeld", "kalm", "vredig"] as const) expect(pick([dream(1)], { values: values(e), rng })?.id).toBe(1);
    const low = () => DREAM_TELL_CHANCE - 0.01;
    for (const e of ["boos", "druk"] as const) expect(pick([dream(1)], { values: values(e), rng: low })).toBeNull();
  });
});
