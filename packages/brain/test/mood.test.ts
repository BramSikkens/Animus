import { describe, expect, it } from "vitest";
import { EMOTIONS, EMOTION_PAIRS } from "../src/emotion.js";
import {
  applyDeltas,
  BASE_LEVEL,
  DELTA_SCALE,
  REST_LEVEL,
  reactivityFactor,
  currentMood,
  displayMood,
  displayMoodOfRow,
  faceIntensity,
  driftOf,
  DRIFT_AMPLITUDE,
  DRIFT_HYSTERESIS,
  MOOD_HALF_LIFE_MS,
  moodOfRow,
  parseMoodValues,
  singleEmotionValues,
  storedMoodOf,
  strength,
  type MoodValues,
  type StoredMood,
} from "../src/mood.js";

const T0 = new Date("2026-01-01T12:00:00.000Z");
const after = (ms: number) => new Date(T0.getTime() + ms);
// Oude fixtures gingen uit van rust op 0 (0-100); op de nieuwe schaal (rust 50) wordt een oude waarde v: 50 + v/2.
const rest = Object.fromEntries(EMOTIONS.map((e) => [e, REST_LEVEL])) as MoodValues;
const values = (over: Partial<MoodValues>): MoodValues => ({ ...rest, ...over });
const stored = (over: Partial<MoodValues>): StoredMood => ({ values: values(over), at: T0 });

describe("strength", () => {
  it("geeft hoe ver een waarde boven de rust (50) staat, als 0..1", () => {
    expect(strength(50)).toBeCloseTo(0);
    expect(strength(100)).toBeCloseTo(1);
    expect(strength(65)).toBeCloseTo(0.3);
    expect(strength(30)).toBe(0); // onder rust clampt naar 0
  });
});

describe("currentMood", () => {
  it("geeft zonder opgeslagen Stemming de ruststand: Basisemotie op 65, de rest op 50", () => {
    const mood = currentMood(null, "blij", T0);
    expect(mood.values).toEqual(values({ blij: BASE_LEVEL, droevig: 35 })); // blij/droevig is een paar
    expect(mood.emotion).toBe("blij");
    expect(mood.intensity).toBeCloseTo(0.3);
  });

  it("zet bij een Basisemotie zonder tegenpool alles op 50 behalve de Basisemotie zelf", () => {
    expect(currentMood(null, "nieuwsgierig", T0).values).toEqual(values({ nieuwsgierig: BASE_LEVEL }));
  });

  it("gebruikt kalm als Basisemotie ontbreekt", () => {
    expect(currentMood(null, null, T0)).toMatchObject({ emotion: "kalm", values: values({ kalm: BASE_LEVEL, druk: 35 }) });
  });

  it("houdt de waarden vers op het moment zelf en kiest de hoogste als zichtbare emotie", () => {
    const mood = currentMood(stored({ boos: 80, blij: 20 }), "kalm", T0);
    expect(mood.emotion).toBe("boos");
    expect(mood.intensity).toBeCloseTo(0.6); // strength(80)
    expect(mood.values.blij).toBeCloseTo(20);
  });

  it("dooft elke emotie exponentieel uit naar de ruststand met een halveringstijd van 3 minuten", () => {
    expect(MOOD_HALF_LIFE_MS).toBe(3 * 60_000);
    const mood = currentMood(stored({ boos: 80, kalm: 20 }), "kalm", after(MOOD_HALF_LIFE_MS));
    expect(mood.values.boos).toBeCloseTo(65); // 80 -> 50: halverwege
    expect(mood.values.kalm).toBeCloseTo(42.5); // 20 -> 65: halverwege
    expect(currentMood(stored({ boos: 80 }), "kalm", after(2 * MOOD_HALF_LIFE_MS)).values.boos).toBeCloseTo(57.5);
  });

  it("dooft ook een emotie boven de ruststand van de Basisemotie omlaag uit", () => {
    expect(currentMood(stored({ kalm: 100 }), "kalm", after(MOOD_HALF_LIFE_MS)).values.kalm).toBeCloseTo(82.5);
  });

  it("wint bij een gelijkstand de Basisemotie, anders de eerste in EMOTIONS", () => {
    expect(currentMood(stored({ blij: 70, kalm: 70 }), "kalm", T0).emotion).toBe("kalm");
    expect(currentMood(stored({ bang: 70, boos: 70 }), "kalm", T0).emotion).toBe("boos");
  });

  it("laat een klok die terugloopt de waarden niet boven de opgeslagen waarde tillen", () => {
    expect(currentMood(stored({ boos: 80 }), "kalm", after(-5 * MOOD_HALF_LIFE_MS)).values.boos).toBeLessThanOrEqual(80);
  });
});

describe("deltaschaal (ADR-0017)", () => {
  const blij = (delta: number, reactivity: number) => applyDeltas(null, "kalm", { blij: delta }, T0, reactivity).mood;

  it("maakt +50 en +100 onderscheidbaar bij reactiviteit 0.5", () => {
    expect(DELTA_SCALE).toBe(0.5);
    expect(blij(100, 0.5).values.blij).toBeCloseTo(100);
    expect(blij(50, 0.5).values.blij).toBeCloseTo(75);
  });

  it("schaalt een kleine delta bij reactiviteit 1 met reactiviteitsfactor en DELTA_SCALE", () => {
    expect(blij(20, 1).values.blij).toBeCloseTo(50 + 20 * 1.95 * 0.5);
  });

  it("geeft bij reactiviteit 0.5 dezelfde sterkte als vroeger: strength = delta/100", () => {
    expect(strength(blij(50, 0.5).values.blij)).toBeCloseTo(0.5);
    expect(strength(blij(30, 0.5).values.blij)).toBeCloseTo(0.3);
  });
});

describe("applyDeltas", () => {
  it("telt de delta's per emotie op bij de uitgedoofde waarden en slaat ze met het tijdstip op", () => {
    const { mood, next } = applyDeltas(stored({ boos: 80 }), "kalm", { blij: 20, boos: -15 }, after(MOOD_HALF_LIFE_MS));
    expect(mood.values.blij).toBeCloseTo(60); // rust 50, +20 * DELTA_SCALE
    expect(mood.values.boos).toBeCloseTo(57.5); // 80 -> 65 uitgedoofd, dan -15 * DELTA_SCALE
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
    expect(mood.values.kalm).toBeCloseTo(BASE_LEVEL); // geen delta op kalm: blijft op de ruststand
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
    expect(boos(0.5)).toBeCloseTo(70); // rust 50, +40 * DELTA_SCALE
    expect(boos(0)).toBeCloseTo(51);
    expect(boos(1)).toBeCloseTo(89); // rust 50, +40 * 1.95 * DELTA_SCALE
  });

  it("dooft langzamer uit bij hoge reactiviteit en sneller bij lage", () => {
    const boos = (reactivity: number) => currentMood(stored({ boos: 80 }), "kalm", after(MOOD_HALF_LIFE_MS), reactivity).values.boos;
    expect(boos(0.5)).toBeCloseTo(65); // rust 50, halverwege naar 80
    expect(boos(1)).toBeGreaterThan(boos(0.5));
    expect(boos(0)).toBeLessThan(boos(0.5));
  });

  it("begrenst de halveringstijd bij r=0 op een kwart (niet absurd snel uitdoven)", () => {
    const boos = currentMood(stored({ boos: 80 }), "kalm", after(MOOD_HALF_LIFE_MS * 0.25), 0).values.boos;
    expect(boos).toBeCloseTo(65);
  });

  it("moodOfRow gebruikt axisReactivity van de rij", () => {
    const row = { baseEmotion: "kalm", moodValues: { boos: 80 }, moodAt: T0 };
    expect(moodOfRow({ ...row, axisReactivity: 1 }, after(MOOD_HALF_LIFE_MS)).values.boos).toBeGreaterThan(50);
  });
});

describe("moodOfRow", () => {
  const empty = { baseEmotion: null, moodValues: null, moodAt: null };

  it("geeft zonder Stemming de ruststand van de Basisemotie, en kalm zonder Basisemotie", () => {
    expect(moodOfRow({ ...empty, baseEmotion: "blij" }, T0)).toMatchObject({ emotion: "blij", intensity: 0.3 });
    expect(moodOfRow(empty, T0).emotion).toBe("kalm");
  });

  it("leest de opgeslagen vector uit de kolommen en dooft hem uit", () => {
    const row = { ...empty, baseEmotion: "kalm", moodValues: values({ boos: 80 }), moodAt: T0 };
    expect(storedMoodOf(row)).toEqual({ values: values({ boos: 80 }), at: T0 });
    expect(moodOfRow(row, after(MOOD_HALF_LIFE_MS)).values.boos).toBeCloseTo(65);
  });

  it("negeert een onbruikbare vector, en telt ontbrekende of ongeldige emoties als rust", () => {
    expect(storedMoodOf({ ...empty, moodValues: "boos", moodAt: T0 })).toBeNull();
    expect(storedMoodOf({ ...empty, moodValues: { boos: 80 }, moodAt: null })).toBeNull();
    expect(storedMoodOf({ ...empty, moodValues: { boos: 80, woedend: 99, blij: "x" }, moodAt: T0 })?.values).toEqual(values({ boos: 80 }));
  });
});

describe("singleEmotionValues", () => {
  it("zet één emotie op de ruststand van base plus intensity*(100-rust), de rest in rust", () => {
    expect(singleEmotionValues("boos", 0.8)).toEqual(values({ boos: 90, vredig: 10 })); // boos/vredig is een paar
  });

  it("gebruikt een aparte base voor de ruststand als die meegegeven wordt", () => {
    expect(singleEmotionValues("nieuwsgierig", 0.5, "blij")).toEqual(values({ nieuwsgierig: 75, blij: BASE_LEVEL, droevig: 35 }));
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

describe("emotieparen (ADR-0015)", () => {
  it("een positieve delta trekt de tegenpool met 50% van die delta omlaag (blij +30 -> droevig -15)", () => {
    const { mood } = applyDeltas(stored({ droevig: 40 }), "verveeld", { blij: 30 }, T0);
    expect(mood.values.blij).toBeCloseTo(65); // rust 50, +30 * DELTA_SCALE
    expect(mood.values.droevig).toBeCloseTo(32.5); // 40 - 15 * DELTA_SCALE; de paar-regel (blij+droevig <= 100) grijpt hier niet meer in
  });

  it("werkt ook omgekeerd en voor de andere paren", () => {
    expect(applyDeltas(stored({ blij: 40 }), "verveeld", { droevig: 20 }, T0).mood.values.blij).toBeCloseTo(35);
    expect(applyDeltas(stored({ vredig: 40 }), "verveeld", { boos: 20 }, T0).mood.values.vredig).toBeCloseTo(35);
    expect(applyDeltas(stored({ druk: 40 }), "verveeld", { kalm: 20 }, T0).mood.values.druk).toBeCloseTo(35);
  });

  it("schaalt de tegenpool-trek mee met reactiviteit en clampt op 0", () => {
    // blij expliciet op 0 gehouden (i.p.v. de rust-default), anders klemt blij zelf al op 100 en drukt de paar-regel droevig verder omlaag.
    expect(applyDeltas(stored({ droevig: 40, blij: 0 }), "verveeld", { blij: 30 }, T0, 1).mood.values.droevig).toBeCloseTo(40 - 15 * reactivityFactor(1) * DELTA_SCALE);
    expect(applyDeltas(stored({ droevig: 5 }), "verveeld", { blij: 30 }, T0).mood.values.droevig).toBe(0);
  });

  it("een negatieve delta trekt de tegenpool niet omhoog", () => {
    expect(applyDeltas(stored({ droevig: 10, blij: 40 }), "verveeld", { blij: -20 }, T0).mood.values.droevig).toBeCloseTo(10);
  });

  it("emoties zonder tegenpool trekken niets", () => {
    const { mood } = applyDeltas(stored({ blij: 40, droevig: 10 }), "verveeld", { bang: 50 }, T0);
    expect(mood.values).toMatchObject({ blij: 40, droevig: 10, bang: 75 }); // bang: rust 50, +50 * DELTA_SCALE
  });

  it("twee hoge waarden van een paar kunnen niet tegelijk bestaan: zelfs bij twee gelijktijdige delta's blijft de som van een paar <= 100", () => {
    const { mood, next } = applyDeltas(stored({}), "verveeld", { blij: 80, droevig: 80 }, T0);
    for (const [a, b] of EMOTION_PAIRS) expect(mood.values[a] + mood.values[b]).toBeLessThanOrEqual(100);
    // Beide komen (vóór de paar-regel) gelijk uit op 70 (rust 50, +(80 min de trek van 40) * DELTA_SCALE); de paar-regel dwingt er dan één omlaag.
    expect(mood.values.blij).toBeCloseTo(30);
    expect(mood.values.droevig).toBeCloseTo(70);
    expect(next?.values).toEqual(mood.values);
  });

  it("de opgeslagen vector en de gelezen Stemming blijven consistent (idempotent)", () => {
    const { next } = applyDeltas(stored({}), "verveeld", { blij: 80, droevig: 80 }, T0);
    expect(currentMood(next, "verveeld", T0).values).toEqual(next?.values);
  });

  it("na het uitdoven blijft een paar consistent: de hoogste remt de ander af", () => {
    // Handmatig gezet (dashboard) kunnen beide hoog zijn; bij het lezen geldt de paar-regel alsnog.
    const mood = currentMood(stored({ boos: 90, vredig: 80 }), "verveeld", T0);
    expect(mood.values.boos).toBeCloseTo(90);
    expect(mood.values.vredig).toBeCloseTo(10);
    const later = currentMood(stored({ boos: 100, vredig: 100 }), "vredig", after(MOOD_HALF_LIFE_MS));
    expect(later.values.boos + later.values.vredig).toBeLessThanOrEqual(100);
  });

  it("ontbrekende sleutels in opgeslagen mood_values lezen als rust (REST_LEVEL)", () => {
    const oud = { blij: 50, boos: 0, verrast: 0, kalm: 30, verveeld: 0, nieuwsgierig: 0, bang: 0 };
    expect(storedMoodOf({ moodValues: oud, moodAt: T0 })?.values).toMatchObject({ blij: 50, droevig: REST_LEVEL, vredig: REST_LEVEL, druk: REST_LEVEL });
  });
});

describe("driftOf (ADR-0017: drift)", () => {
  it("slaat echt uit: minstens de helft van de tijd voorbij de halve amplitude, en haalt (bijna) de volle", () => {
    for (const emotion of EMOTIONS) {
      let wide = 0;
      let peak = 0;
      for (let s = 0; s < 3600; s++) {
        const value = Math.abs(driftOf(emotion, "7", after(s * 1000)));
        if (value > 0.5) wide++;
        peak = Math.max(peak, value);
      }
      expect(wide / 3600).toBeGreaterThan(0.5);
      expect(peak).toBeGreaterThan(0.9);
    }
  });

  it("blijft binnen [-1, 1] over een sweep van elke seconde gedurende een uur", () => {
    for (let s = 0; s <= 3600; s++) {
      const value = driftOf("blij", "seed-a", after(s * 1000));
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministisch: zelfde emotie/seed/tijd geeft altijd dezelfde waarde", () => {
    expect(driftOf("blij", "seed-a", after(12_345))).toBe(driftOf("blij", "seed-a", after(12_345)));
  });

  it("verandert met de tijd", () => {
    expect(driftOf("blij", "seed-a", T0)).not.toBeCloseTo(driftOf("blij", "seed-a", after(30_000)), 5);
  });

  it("verschilt tussen emoties (andere fase per emotie)", () => {
    expect(driftOf("blij", "seed-a", T0)).not.toBeCloseTo(driftOf("boos", "seed-a", T0), 5);
  });

  it("verschilt tussen seeds (elke Dynimo golft anders)", () => {
    expect(driftOf("blij", "seed-a", T0)).not.toBeCloseTo(driftOf("blij", "seed-b", T0), 5);
  });
});

describe("displayMood (ADR-0017: drift)", () => {
  it("blijft in rust dominant op een gepaarde Basisemotie (blij), reactiviteit 1, over een uur", () => {
    for (let s = 0; s <= 3600; s++) {
      expect(displayMood(null, "blij", after(s * 1000), 1, "dynimo-1").emotion).toBe("blij");
    }
  });

  it("blijft in rust dominant op een ongepaarde Basisemotie (nieuwsgierig), reactiviteit 1, over een uur", () => {
    for (let s = 0; s <= 3600; s++) {
      expect(displayMood(null, "nieuwsgierig", after(s * 1000), 1, "dynimo-2").emotion).toBe("nieuwsgierig");
    }
  });

  it("shown blijft 0–100 en de paar-invariant geldt", () => {
    for (let s = 0; s <= 3600; s += 41) {
      const mood = displayMood(stored({ boos: 95, blij: 90, droevig: 90 }), "verveeld", after(s * 1000), 1, "dynimo-3");
      for (const emotion of EMOTIONS) {
        expect(mood.values[emotion]).toBeGreaterThanOrEqual(0);
        expect(mood.values[emotion]).toBeLessThanOrEqual(100);
      }
      for (const [a, b] of EMOTION_PAIRS) {
        expect(Math.min(mood.values[a], mood.values[b])).toBeLessThanOrEqual(100 - Math.max(mood.values[a], mood.values[b]));
      }
    }
  });

  it("reactiviteit 0 geeft een amplitude van ~0.5: shown wijkt nauwelijks af van de ruststand", () => {
    for (let s = 0; s <= 3600; s += 41) {
      const now = after(s * 1000);
      const truth = currentMood(null, "kalm", now, 0);
      const shown = displayMood(null, "kalm", now, 0, "dynimo-4").values;
      for (const emotion of EMOTIONS) {
        expect(Math.abs(shown[emotion] - truth.values[emotion])).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  // Hysterese los van de precieze golfvorm: over een sweep zoeken we zelf momenten waarop "verrast" na drift nipt
  // (< 8) of ruim (>= 8) boven de echte dominant "nieuwsgierig" uitkomt, en eisen dat beide gevallen voorkomen.
  it("hysterese: wisselt pas als een andere emotie na drift met minstens DRIFT_HYSTERESIS wint", () => {
    let nipt = 0;
    let ruim = 0;
    for (let s = 0; s < 600; s++) {
      const now = after(s * 1000);
      const truthVector: StoredMood = { values: values({ nieuwsgierig: 80, verrast: 77 }), at: now }; // echte voorsprong 3
      expect(currentMood(truthVector, "kalm", now).emotion).toBe("nieuwsgierig");
      const mood = displayMood(truthVector, "kalm", now, 1, "hysterese-seed");
      const lead = mood.values.verrast - mood.values.nieuwsgierig;
      if (lead > 0 && lead < DRIFT_HYSTERESIS) {
        nipt++;
        expect(mood.emotion).toBe("nieuwsgierig");
      } else if (lead >= DRIFT_HYSTERESIS) {
        ruim++;
        expect(mood.emotion).toBe("verrast");
      }
    }
    expect(nipt).toBeGreaterThan(0);
    expect(ruim).toBeGreaterThan(0);
  });
});

describe("displayMoodOfRow (ADR-0017: drift)", () => {
  it("gebruikt de kolommen en de rij-id als drift-seed", () => {
    const row = { id: 7, baseEmotion: "blij", moodValues: null, moodAt: null, axisReactivity: 1 };
    const mood = displayMoodOfRow(row, T0);
    expect(mood).toEqual(displayMood(storedMoodOf(row), "blij", T0, 1, "7"));
  });
});

describe("faceIntensity", () => {
  it("laat de intensiteit ongewijzigd bij de standaard expressiviteit 0.5", () => {
    expect(faceIntensity(0.6, 0.5)).toBeCloseTo(0.6);
  });

  it("halveert de intensiteit bij expressiviteit 0 (gesloten)", () => {
    expect(faceIntensity(0.6, 0)).toBeCloseTo(0.3);
  });

  it("maakt de intensiteit anderhalf keer zo sterk bij expressiviteit 1, geklemd op 1", () => {
    expect(faceIntensity(0.4, 1)).toBeCloseTo(0.6);
    expect(faceIntensity(0.8, 1)).toBe(1);
  });

  it("laat intensiteit 0 altijd 0 blijven", () => {
    expect(faceIntensity(0, 1)).toBe(0);
  });

  it("klemt op minimaal 0", () => {
    expect(faceIntensity(0.5, -2)).toBe(0);
  });
});
