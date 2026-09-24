import { describe, expect, it } from "vitest";
import {
  applyEmotion,
  BASE_INTENSITY,
  currentMood,
  MOOD_HALF_LIFE_MS,
  moodOfRow,
  storedMoodOf,
  type StoredMood,
} from "../src/mood.js";

const T0 = new Date("2026-01-01T12:00:00.000Z");
const after = (ms: number) => new Date(T0.getTime() + ms);
const stored = (emotion: "boos" | "blij", intensity: number): StoredMood => ({ emotion, intensity, at: T0 });

describe("currentMood", () => {
  it("houdt de intensiteit vers op het moment zelf", () => {
    expect(currentMood(stored("boos", 0.8), "kalm", T0)).toEqual({ emotion: "boos", intensity: 0.8 });
  });

  it("halveert de intensiteit na 10 minuten en kwart na 20", () => {
    expect(MOOD_HALF_LIFE_MS).toBe(10 * 60_000);
    expect(currentMood(stored("boos", 0.8), "kalm", after(MOOD_HALF_LIFE_MS)).intensity).toBeCloseTo(0.4);
    expect(currentMood(stored("boos", 0.8), "kalm", after(2 * MOOD_HALF_LIFE_MS)).intensity).toBeCloseTo(0.2);
  });

  it("valt terug op de Basisemotie zodra de uitgedoofde intensiteit onder de drempel komt", () => {
    // 0.4 na 10 min, 0.2 na 20, 0.1 (= drempel, nog Stemming) na 30 min, daarna Basisemotie.
    expect(currentMood(stored("boos", 0.8), "kalm", after(3 * MOOD_HALF_LIFE_MS)).emotion).toBe("boos");
    expect(currentMood(stored("boos", 0.8), "kalm", after(3 * MOOD_HALF_LIFE_MS + 60_000))).toEqual({
      emotion: "kalm",
      intensity: BASE_INTENSITY,
    });
  });

  it("laat de intensiteit nooit boven de opgeslagen waarde uitkomen als de klok terugloopt (at in de toekomst)", () => {
    expect(currentMood(stored("boos", 0.8), "kalm", after(-5 * MOOD_HALF_LIFE_MS)).intensity).toBeLessThanOrEqual(0.8);
  });

  it("geeft zonder opgeslagen Stemming de Basisemotie, en neutraal als de Basisemotie ontbreekt", () => {
    expect(currentMood(null, "blij", T0)).toEqual({ emotion: "blij", intensity: BASE_INTENSITY });
    expect(currentMood(null, null, T0)).toEqual({ emotion: "neutraal", intensity: BASE_INTENSITY });
  });
});

describe("applyEmotion", () => {
  it("laat een sterkere Emotie de Stemming vervangen en zet het tijdstip", () => {
    const result = applyEmotion(stored("boos", 0.5), "kalm", "blij", 0.9, after(60_000));
    expect(result.mood).toEqual({ emotion: "blij", intensity: 0.9 });
    expect(result.next).toEqual({ emotion: "blij", intensity: 0.9, at: after(60_000) });
  });

  it("laat een zwakkere Emotie de sterkere Stemming niet vervangen, en ververst het tijdstip niet", () => {
    const start = stored("boos", 0.8);
    const result = applyEmotion(start, "kalm", "blij", 0.3, after(60_000));
    expect(result.next).toBe(start);
    expect(result.mood.emotion).toBe("boos");
  });

  it("vervangt bij een gelijke intensiteit niet", () => {
    const start = stored("boos", 0.6);
    const result = applyEmotion(start, "kalm", "blij", 0.6, T0);
    expect(result.next).toBe(start);
    expect(result.mood).toEqual({ emotion: "boos", intensity: 0.6 });
  });

  it("vergelijkt met de uitgedoofde Stemming: een zwakke Emotie wint van een sterke van lang geleden", () => {
    const result = applyEmotion(stored("boos", 0.8), "kalm", "blij", 0.35, after(MOOD_HALF_LIFE_MS)); // boos is nu 0.4... 0.35 < 0.4
    expect(result.next?.emotion).toBe("boos");
    const later = applyEmotion(stored("boos", 0.8), "kalm", "blij", 0.35, after(2 * MOOD_HALF_LIFE_MS)); // boos is nu 0.2
    expect(later.next).toEqual({ emotion: "blij", intensity: 0.35, at: after(2 * MOOD_HALF_LIFE_MS) });
  });

  it("vergelijkt zonder Stemming met het Basisemotie-niveau: alleen strikt sterkere Emotie wint", () => {
    expect(applyEmotion(null, "kalm", "blij", BASE_INTENSITY, T0)).toEqual({
      mood: { emotion: "kalm", intensity: BASE_INTENSITY },
      next: null,
    });
    expect(applyEmotion(null, "kalm", "blij", BASE_INTENSITY + 0.01, T0).next).toEqual({
      emotion: "blij",
      intensity: BASE_INTENSITY + 0.01,
      at: T0,
    });
  });

  it("laat een Emotie met intensiteit 0 (mislukte Type1) de Stemming ongemoeid", () => {
    const start = stored("boos", 0.8);
    expect(applyEmotion(start, "kalm", "neutraal", 0, after(1000)).next).toBe(start);
  });
});

describe("moodOfRow", () => {
  const empty = { baseEmotion: null, moodEmotion: null, moodIntensity: null, moodAt: null };

  it("geeft zonder Stemming de Basisemotie, en neutraal zonder Basisemotie", () => {
    expect(moodOfRow({ ...empty, baseEmotion: "blij" }, T0)).toEqual({ emotion: "blij", intensity: BASE_INTENSITY });
    expect(moodOfRow(empty, T0)).toEqual({ emotion: "neutraal", intensity: BASE_INTENSITY });
  });

  it("leest de opgeslagen Stemming uit de kolommen en dooft ze uit", () => {
    const row = { ...empty, baseEmotion: "kalm", moodEmotion: "boos", moodIntensity: 0.8, moodAt: T0 };
    expect(storedMoodOf(row)).toEqual({ emotion: "boos", intensity: 0.8, at: T0 });
    expect(moodOfRow(row, after(MOOD_HALF_LIFE_MS)).intensity).toBeCloseTo(0.4);
  });

  it("negeert een ongeldige emotie in de kolommen", () => {
    expect(storedMoodOf({ ...empty, moodEmotion: "woedend", moodIntensity: 0.8, moodAt: T0 })).toBeNull();
  });
});
