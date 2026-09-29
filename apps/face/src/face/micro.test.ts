import { describe, expect, it } from "vitest";
import type { Emotion } from "@animus/core/emotion";
import { microExpression } from "./micro.js";

const values = (over: Partial<Record<Emotion, number>> = {}) => ({ ...over }) as Record<Emotion, number>;
const NONE = { browRaise: 0, frown: 0, smile: 0 };

describe("microExpression", () => {
  it("wenkbrauw omhoog bij een vraag terwijl Animus luistert", () => {
    expect(microExpression({ displayState: "luisterend", lastUserText: "Hoe laat is het?", values: values() }).browRaise).toBeGreaterThan(0);
  });

  it("geen wenkbrauw zonder vraagteken, zonder tekst of bij slapend", () => {
    expect(microExpression({ displayState: "luisterend", lastUserText: "Het regent.", values: values() })).toEqual(NONE);
    expect(microExpression({ displayState: "luisterend", values: values() })).toEqual(NONE);
    expect(microExpression({ displayState: "slapend", lastUserText: "Hoe gaat het?", values: values() })).toEqual(NONE);
  });

  it("vraagteken telt ook met trailing spaties, en net na luisteren (reflecterend)", () => {
    expect(microExpression({ displayState: "reflecterend", lastUserText: "Echt waar? ", values: values() }).browRaise).toBeGreaterThan(0);
  });

  it("frons bij boos >= 60, groeit tot 1 bij 100, niets eronder", () => {
    expect(microExpression({ displayState: "wakker", values: values({ boos: 59 }) }).frown).toBe(0);
    expect(microExpression({ displayState: "wakker", values: values({ boos: 60 }) }).frown).toBeGreaterThan(0);
    expect(microExpression({ displayState: "spreekt", values: values({ boos: 100 }) }).frown).toBe(1);
    expect(microExpression({ displayState: "slapend", values: values({ boos: 100 }) }).frown).toBe(0);
  });

  it("glimlach bij complimentwoorden (hoofdletterongevoelig), niet bij andere tekst of slapend", () => {
    for (const t of ["Goed gedaan!", "Dat is lief", "top", "Wat mooi", "Bedankt", "dank je wel"]) {
      expect(microExpression({ displayState: "luisterend", lastUserText: t, values: values() }).smile, t).toBeGreaterThan(0);
    }
    expect(microExpression({ displayState: "luisterend", lastUserText: "Het is stoplicht rood", values: values() }).smile).toBe(0);
    expect(microExpression({ displayState: "slapend", lastUserText: "top", values: values() }).smile).toBe(0);
  });
});
