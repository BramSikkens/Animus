import { describe, expect, it } from "vitest";
import { singleEmotionValues } from "../src/mood.js";
import { pacingFor } from "../src/speech-pacing.js";

const at = (emotion: Parameters<typeof singleEmotionValues>[0], intensity = 1, expressiveness = 1) =>
  pacingFor({ values: singleEmotionValues(emotion, intensity), expressiveness });

describe("pacingFor", () => {
  it("is neutraal bij expressiviteit 0", () => {
    expect(at("droevig", 1, 0)).toEqual({ pauseLevel: 0, speedFactor: 1, halting: false });
  });
  it("is neutraal bij een neutrale of zwakke Stemming", () => {
    expect(at("neutraal")).toEqual({ pauseLevel: 0, speedFactor: 1, halting: false });
    expect(at("blij", 0.1).pauseLevel).toBe(0);
  });
  it.each(["blij", "druk", "verrast"] as const)("%s: korte pauzes, sneller", (e) => {
    const p = at(e);
    expect(p.pauseLevel).toBe(1);
    expect(p.speedFactor).toBeGreaterThan(1);
  });
  it.each(["droevig", "vredig", "kalm", "verveeld"] as const)("%s: lange pauzes, langzamer", (e) => {
    const p = at(e);
    expect(p.pauseLevel).toBe(2);
    expect(p.speedFactor).toBeLessThan(1);
  });
  it("bang: haperend met korte pauzes", () => {
    expect(at("bang")).toMatchObject({ pauseLevel: 1, halting: true });
  });
  it("schaalt het tempo met waarde en expressiviteit", () => {
    const full = at("blij").speedFactor;
    const half = at("blij", 1, 0.5).speedFactor;
    const weak = at("blij", 0.5).speedFactor;
    expect(half - 1).toBeCloseTo((full - 1) / 2);
    expect(weak - 1).toBeCloseTo((full - 1) / 2);
  });
});

import { applyPauses } from "../src/speech-pacing.js";

const LONG = "Dit is een best lange zin van meer dan veertig tekens.";

describe("applyPauses", () => {
  it("doet niets bij niveau 0", () => {
    expect(applyPauses(`${LONG} Nog een zin.`, 0)).toBe(`${LONG} Nog een zin.`);
  });
  it("niveau 1: ' … ' na zinnen langer dan 40 tekens, niet na korte", () => {
    expect(applyPauses(`${LONG} Kort. Ja!`, 1)).toBe(`${LONG} … Kort. Ja!`);
  });
  it("niveau 2: '… ' na elke zin, ook ! en ?", () => {
    expect(applyPauses("Hoi. Wat doe je? Fijn!", 2)).toBe("Hoi. … Wat doe je? … Fijn!");
  });
  it("voegt geen pauze toe aan het einde van de tekst", () => {
    expect(applyPauses("Hoi.", 2)).toBe("Hoi.");
  });
  it("breekt afkortingen, getallen en URL's niet", () => {
    expect(applyPauses("Bijv. een appel, enz. en meer. Het kost 3.5 euro en zie www.voorbeeld.nl voor meer. Klaar.", 2)).toBe(
      "Bijv. een appel, enz. en meer. … Het kost 3.5 euro en zie www.voorbeeld.nl voor meer. … Klaar.",
    );
    expect(applyPauses("Dat is punt 3. Dan volgt de rest.", 2)).toBe("Dat is punt 3. Dan volgt de rest.");
  });
  it("dubbelt bestaande '…' niet", () => {
    expect(applyPauses("Hmm… Wacht even. Nou… Goed.", 2)).toBe("Hmm… Wacht even. … Nou… Goed.");
  });
  it("niveau 2: soms ook na een komma (lange voorafgaande deel), niveau 1 niet", () => {
    const text = "Als ik er goed over nadenk, dan denk ik van wel.";
    expect(applyPauses(text, 2)).toBe("Als ik er goed over nadenk, … dan denk ik van wel.");
    expect(applyPauses(text, 1)).toBe(text);
    expect(applyPauses("Ja, dat wel.", 2)).toBe("Ja, dat wel.");
  });
  it("halting: extra '…' bij komma's, ook op niveau 1", () => {
    expect(applyPauses("Ik, eh, weet het niet zeker.", 1, true)).toBe("Ik, … eh, … weet het niet zeker.");
  });
  it("is deterministisch", () => {
    expect(applyPauses(`${LONG} ${LONG}`, 2)).toBe(applyPauses(`${LONG} ${LONG}`, 2));
  });
});

import { createPacer } from "../src/speech-pacing.js";

describe("createPacer (streaming)", () => {
  const run = (chunks: string[], level: 0 | 1 | 2, halting = false) => {
    const p = createPacer(level, halting);
    return [...chunks.map((c) => p.push(c)), p.flush()];
  };
  const TEXT = "Als ik er goed over nadenk, dan denk ik van wel. Bijv. dit ook. Zeker weten! En nog iets.";

  it("geeft bij elke chunkverdeling hetzelfde als applyPauses over het geheel", () => {
    for (const level of [1, 2] as const) {
      for (const size of [1, 2, 3, 7, 20, TEXT.length]) {
        const chunks = TEXT.match(new RegExp(`[^]{1,${size}}`, "g"))!;
        expect(run(chunks, level, level === 1).join("")).toBe(applyPauses(TEXT, level, level === 1));
      }
    }
  });
  it("laat niveau 0 direct en ongewijzigd door", () => {
    expect(run(["Hoi. ", "Daar."], 0)).toEqual(["Hoi. ", "Daar.", ""]);
  });
  it("geeft een eerste zin vrij zodra de volgende begint, niet pas aan het einde", () => {
    const out = run(["Hoi daar. ", "Wat ", "leuk."], 2);
    expect(out[0]).toBe("");
    expect(out[1]).toBe("Hoi daar. … ");
  });
});

import { withPacingSpeed } from "../src/speech-pacing.js";

describe("withPacingSpeed", () => {
  const s = { stability: 0.4, style: 0.2, speed: 1.1, similarity_boost: 0.75 };
  it("vermenigvuldigt speed en laat de rest ongemoeid", () => {
    expect(withPacingSpeed(s, 0.9)).toEqual({ ...s, speed: 1.1 * 0.9 });
  });
  it("clampt op 0.7-1.2", () => {
    expect(withPacingSpeed(s, 1.5).speed).toBe(1.2);
    expect(withPacingSpeed({ ...s, speed: 0.75 }, 0.5).speed).toBe(0.7);
  });
});
