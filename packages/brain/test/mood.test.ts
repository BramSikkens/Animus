import { describe, expect, it } from "vitest";
import { EMOTIONS } from "../src/emotion.js";
import { applyDeltas, BASE_LEVEL, currentMood, MOOD_HALF_LIFE_MS, moodOfRow, parseMoodValues, singleEmotionValues, storedMoodOf, type MoodValues, type StoredMood } from "../src/mood.js";

const T0 = new Date("2026-01-01T12:00:00.000Z");
const after = (ms: number) => new Date(T0.getTime() + ms);
const zeros = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as MoodValues;
const values = (over: Partial<MoodValues>): MoodValues => ({ ...zeros, ...over });
const stored = (over: Partial<MoodValues>): StoredMood => ({ values: values(over), at: T0 });

describe("currentMood", () => {
  it("geeft zonder opgeslagen Stemming de ruststand: Basisemotie op 30, de rest op 0", () => {
    const mood = currentMood(null, "blij", T0);
    expect(mood.values).toEqual(values({ blij: BASE_LEVEL }));
    expect(mood.emotion).toBe("blij");
    expect(mood.intensity).toBeCloseTo(0.3);
  });

  it("gebruikt neutraal als Basisemotie ontbreekt", () => {
    expect(currentMood(null, null, T0)).toMatchObject({ emotion: "neutraal", values: values({ neutraal: BASE_LEVEL }) });
  });

  it("houdt de waarden vers op het moment zelf en kiest de hoogste als zichtbare emotie", () => {
    const mood = currentMood(stored({ boos: 80, blij: 20 }), "kalm", T0);
    expect(mood.emotion).toBe("boos");
    expect(mood.intensity).toBeCloseTo(0.8);
    expect(mood.values.blij).toBeCloseTo(20);
  });

  it("dooft elke emotie exponentieel uit naar de ruststand met een halveringstijd van 3 minuten", () => {
    expect(MOOD_HALF_LIFE_MS).toBe(3 * 60_000);
    const mood = currentMood(stored({ boos: 80, kalm: 0 }), "kalm", after(MOOD_HALF_LIFE_MS));
    expect(mood.values.boos).toBeCloseTo(40);
    expect(mood.values.kalm).toBeCloseTo(15); // 0 -> 30: halverwege
    expect(currentMood(stored({ boos: 80 }), "kalm", after(2 * MOOD_HALF_LIFE_MS)).values.boos).toBeCloseTo(20);
  });

  it("dooft ook een emotie boven de ruststand van de Basisemotie omlaag uit", () => {
    expect(currentMood(stored({ kalm: 100 }), "kalm", after(MOOD_HALF_LIFE_MS)).values.kalm).toBeCloseTo(65);
  });

  it("wint bij een gelijkstand de Basisemotie, anders de eerste in EMOTIONS", () => {
    expect(currentMood(stored({ blij: 50, kalm: 50 }), "kalm", T0).emotion).toBe("kalm");
    expect(currentMood(stored({ bang: 50, boos: 50 }), "kalm", T0).emotion).toBe("boos");
  });

  it("laat een klok die terugloopt de waarden niet boven de opgeslagen waarde tillen", () => {
    expect(currentMood(stored({ boos: 80 }), "kalm", after(-5 * MOOD_HALF_LIFE_MS)).values.boos).toBeLessThanOrEqual(80);
  });
});

describe("applyDeltas", () => {
  it("telt de delta's per emotie op bij de uitgedoofde waarden en slaat ze met het tijdstip op", () => {
    const { mood, next } = applyDeltas(stored({ boos: 80 }), "kalm", { blij: 20, boos: -15 }, after(MOOD_HALF_LIFE_MS));
    expect(mood.values.blij).toBeCloseTo(20);
    expect(mood.values.boos).toBeCloseTo(25); // 80 -> 40 uitgedoofd, dan -15
    expect(next?.at).toEqual(after(MOOD_HALF_LIFE_MS));
    expect(next?.values).toEqual(mood.values);
  });

  it("clampt elke emotie op 0–100", () => {
    const { mood } = applyDeltas(stored({ boos: 90, blij: 5 }), "kalm", { boos: 50, blij: -40 }, T0);
    expect(mood.values.boos).toBe(100);
    expect(mood.values.blij).toBe(0);
  });

  it("laat vanuit de ruststand een delta op de Basisemotie of een andere emotie meetellen", () => {
    const { mood } = applyDeltas(null, "kalm", { blij: 40 }, T0);
    expect(mood).toMatchObject({ emotion: "blij" });
    expect(mood.values.kalm).toBeCloseTo(30);
  });

  it("laat een lege of nul-delta de opgeslagen Stemming (en haar tijdstip) ongemoeid", () => {
    const start = stored({ boos: 80 });
    expect(applyDeltas(start, "kalm", {}, after(1000)).next).toBe(start);
    expect(applyDeltas(start, "kalm", { blij: 0 }, after(1000)).next).toBe(start);
    expect(applyDeltas(null, "kalm", {}, T0).next).toBeNull();
  });

  it("laat boos van 96 bij herhaalde geruststelling zakken tot een andere emotie wint", () => {
    let state: StoredMood = stored({ boos: 96 });
    let mood = currentMood(state, "kalm", T0);
    for (let i = 1; i <= 4; i++) {
      ({ mood, next: state } = applyDeltas(state, "kalm", { boos: -30, kalm: 20 }, after(i * 10_000)));
    }
    expect(mood.values.boos).toBeLessThan(mood.values.kalm);
    expect(mood.emotion).toBe("kalm");
  });
});

describe("reactiviteit", () => {
  it("schaalt de Type1-delta's: 0 nauwelijks, 0.5 ongewijzigd, 1 sterk", () => {
    const boos = (reactivity: number) => applyDeltas(null, "kalm", { boos: 40 }, T0, reactivity).mood.values.boos;
    expect(boos(0.5)).toBeCloseTo(40);
    expect(boos(0)).toBeCloseTo(10);
    expect(boos(1)).toBeCloseTo(70);
  });

  it("dooft langzamer uit bij hoge reactiviteit en sneller bij lage", () => {
    const boos = (reactivity: number) => currentMood(stored({ boos: 80 }), "kalm", after(MOOD_HALF_LIFE_MS), reactivity).values.boos;
    expect(boos(0.5)).toBeCloseTo(40);
    expect(boos(1)).toBeGreaterThan(50);
    expect(boos(0)).toBeLessThan(20);
  });

  it("moodOfRow gebruikt axisReactivity van de rij", () => {
    const row = { baseEmotion: "kalm", moodValues: { boos: 80 }, moodAt: T0 };
    expect(moodOfRow({ ...row, axisReactivity: 1 }, after(MOOD_HALF_LIFE_MS)).values.boos).toBeGreaterThan(50);
  });
});

describe("moodOfRow", () => {
  const empty = { baseEmotion: null, moodValues: null, moodAt: null };

  it("geeft zonder Stemming de ruststand van de Basisemotie, en neutraal zonder Basisemotie", () => {
    expect(moodOfRow({ ...empty, baseEmotion: "blij" }, T0)).toMatchObject({ emotion: "blij", intensity: 0.3 });
    expect(moodOfRow(empty, T0).emotion).toBe("neutraal");
  });

  it("leest de opgeslagen vector uit de kolommen en dooft hem uit", () => {
    const row = { ...empty, baseEmotion: "kalm", moodValues: values({ boos: 80 }), moodAt: T0 };
    expect(storedMoodOf(row)).toEqual({ values: values({ boos: 80 }), at: T0 });
    expect(moodOfRow(row, after(MOOD_HALF_LIFE_MS)).values.boos).toBeCloseTo(40);
  });

  it("negeert een onbruikbare vector, en telt ontbrekende of ongeldige emoties als 0", () => {
    expect(storedMoodOf({ ...empty, moodValues: "boos", moodAt: T0 })).toBeNull();
    expect(storedMoodOf({ ...empty, moodValues: { boos: 80 }, moodAt: null })).toBeNull();
    expect(storedMoodOf({ ...empty, moodValues: { boos: 80, woedend: 99, blij: "x" }, moodAt: T0 })?.values).toEqual(values({ boos: 80 }));
  });
});

describe("singleEmotionValues", () => {
  it("zet één emotie op intensiteit*100 en de rest op 0", () => {
    expect(singleEmotionValues("boos", 0.8)).toEqual(values({ boos: 80 }));
  });
});

describe("parseMoodValues", () => {
  const field = (over: Record<string, unknown>) => (name: string) => over[name] ?? null;

  it("leest elke emotie uit veld `mood_<emotie>` als getal", () => {
    const parsed = parseMoodValues(field(Object.fromEntries(EMOTIONS.map((e, i) => [`mood_${e}`, String(i * 10)]))));
    expect(parsed).toEqual(Object.fromEntries(EMOTIONS.map((e, i) => [e, i * 10])));
  });

  it("clampt op 0–100", () => {
    const parsed = parseMoodValues(field({ ...Object.fromEntries(EMOTIONS.map((e) => [`mood_${e}`, "5"])), mood_blij: "150", mood_boos: "-3" }));
    expect(parsed).toMatchObject({ blij: 100, boos: 0, kalm: 5 });
  });

  it("geeft null bij een ontbrekende of niet-numerieke waarde", () => {
    const all = Object.fromEntries(EMOTIONS.map((e) => [`mood_${e}`, "5"]));
    expect(parseMoodValues(field({ ...all, mood_bang: "abc" }))).toBeNull();
    expect(parseMoodValues(field({ ...all, mood_bang: "" }))).toBeNull();
    expect(parseMoodValues(field({}))).toBeNull();
  });
});
