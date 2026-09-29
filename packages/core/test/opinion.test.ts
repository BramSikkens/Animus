import { describe, expect, it } from "vitest";
import { decideOpinion, matchDrives, OPINION_COOLDOWN_TURNS, OPINION_MATCH_THRESHOLD } from "../src/opinion.js";
import type { Axes } from "../src/personality.js";
import type { DriveRow } from "../src/drives.js";

const axes: Axes = { ie: 0.5, sn: 0.5, tf: 0.5, jp: 0.5, reactivity: 0.5, expressiveness: 0.5 };
const drive = (id: number, kind: DriveRow["kind"]): DriveRow => ({ id, kind, text: "x", status: null });
const drives = [drive(1, "ergernis"), drive(2, "wens")];
const strong = OPINION_MATCH_THRESHOLD + 0.1;

describe("decideOpinion: wanneer een Drijfveer 'aan' staat", () => {
  it("geen match: geen Standpunt, en de rng wordt niet eens geraadpleegd", () => {
    const rng = () => { throw new Error("rng niet nodig"); };
    expect(decideOpinion({ drives, utteranceMatches: [], axes, rng })).toEqual({ kind: "geen" });
  });

  it("match onder de drempel: geen Standpunt", () => {
    const matches = [{ driveId: 1, score: OPINION_MATCH_THRESHOLD - 0.01 }];
    expect(decideOpinion({ drives, utteranceMatches: matches, axes, rng: () => 0 })).toEqual({ kind: "geen" });
  });

  it("cooldown: binnen N beurten geen Standpunt, daarna weer wel", () => {
    const matches = [{ driveId: 2, score: strong }];
    for (let ago = 1; ago < OPINION_COOLDOWN_TURNS; ago++) {
      expect(decideOpinion({ drives, utteranceMatches: matches, axes, rng: () => 0, lastOpinionTurnsAgo: ago }).kind).toBe("geen");
    }
    expect(decideOpinion({ drives, utteranceMatches: matches, axes, rng: () => 0, lastOpinionTurnsAgo: OPINION_COOLDOWN_TURNS }).kind).toBe("voorkeur");
  });
});

describe("decideOpinion: Wens, Doel en Toekomstdroom", () => {
  it("geeft een voorkeur, nooit tegenspraak, met de gematchte Drijfveer", () => {
    const kinds = ["wens", "doel", "toekomstdroom"] as const;
    for (const [i, kind] of kinds.entries()) {
      const result = decideOpinion({ drives: [drive(i, kind)], utteranceMatches: [{ driveId: i, score: strong }], axes, rng: () => 0 });
      expect(result).toEqual({ kind: "voorkeur", driveId: i });
    }
  });

  it("de kans schaalt met expressiviteit: dezelfde worp triggert bij expressief, niet bij gesloten", () => {
    const matches = [{ driveId: 2, score: strong }];
    const open = { ...axes, expressiveness: 1 };
    const closed = { ...axes, expressiveness: 0 };
    expect(decideOpinion({ drives, utteranceMatches: matches, axes: open, rng: () => 0.6 }).kind).toBe("voorkeur");
    expect(decideOpinion({ drives, utteranceMatches: matches, axes: closed, rng: () => 0.6 }).kind).toBe("geen");
  });

  it("kiest de best matchende Drijfveer", () => {
    const d = [drive(1, "wens"), drive(2, "doel")];
    const matches = [{ driveId: 1, score: 0.6 }, { driveId: 2, score: 0.9 }];
    expect(decideOpinion({ drives: d, utteranceMatches: matches, axes, rng: () => 0 }).driveId).toBe(2);
  });
});

// Volgorde van rng-worpen: eerst de kans, dan (enkel bij Ergernis) tegenspraak versus saai.
const seq = (...values: number[]) => { let i = 0; return () => values[i++]!; };
const ergernisMatch = [{ driveId: 1, score: strong }];
const tJ: Axes = { ...axes, tf: 0, jp: 0, expressiveness: 1 };
const fP: Axes = { ...axes, tf: 1, jp: 1, expressiveness: 0 };

describe("decideOpinion: Ergernis", () => {
  it("wordt tegenspraak of saai, nooit voorkeur", () => {
    const tegen = decideOpinion({ drives, utteranceMatches: ergernisMatch, axes: tJ, rng: seq(0, 0) });
    const saai = decideOpinion({ drives, utteranceMatches: ergernisMatch, axes: tJ, rng: seq(0, 0.99) });
    expect(tegen).toEqual({ kind: "tegenspraak", driveId: 1 });
    expect(saai).toEqual({ kind: "saai", driveId: 1 });
  });

  it("zakelijk (T) en gestructureerd (J) en expressief triggert vaker dan warm (F), speels (P) en gesloten", () => {
    expect(decideOpinion({ drives, utteranceMatches: ergernisMatch, axes: tJ, rng: seq(0.6, 0) }).kind).toBe("tegenspraak");
    expect(decideOpinion({ drives, utteranceMatches: ergernisMatch, axes: fP, rng: seq(0.6, 0) }).kind).toBe("geen");
  });

  it("warm (F) kiest vaker 'saai', zakelijk (T) vaker tegenspraak, bij dezelfde tweede worp", () => {
    expect(decideOpinion({ drives, utteranceMatches: ergernisMatch, axes: { ...tJ, tf: 0 }, rng: seq(0, 0.5) }).kind).toBe("tegenspraak");
    expect(decideOpinion({ drives, utteranceMatches: ergernisMatch, axes: { ...tJ, tf: 1 }, rng: seq(0, 0.5) }).kind).toBe("saai");
  });
});

describe("matchDrives (woord-overlap)", () => {
  const rows: DriveRow[] = [
    { id: 1, kind: "ergernis", text: "Ik erger me aan mensen die te laat komen", status: null },
    { id: 2, kind: "wens", text: "Ik wil graag voetbal spelen", status: null },
    { id: 3, kind: "doel", text: "Beter leren tekenen", status: "actief" },
  ];

  it("scoort de gedeelde inhoudswoorden, zonder stopwoorden, hoofdletters en leestekens", () => {
    const matches = matchDrives("Mijn vriend komt ALTIJD te laat, mensen die laat komen!", rows);
    const ergernis = matches.find((m) => m.driveId === 1)!;
    expect(ergernis.score).toBeGreaterThanOrEqual(OPINION_MATCH_THRESHOLD);
  });

  it("geeft alleen Drijfveren met overlap terug; niets bij een ongerelateerde uiting", () => {
    expect(matchDrives("Wat eten we vanavond?", rows)).toEqual([]);
    expect(matchDrives("Ik wil ook graag voetbal kijken", rows).map((m) => m.driveId)).toEqual([2]);
  });

  it("vereist minstens 2 gedeelde inhoudswoorden (geen vals Standpunt op één woord)", () => {
    expect(matchDrives("Kom je laat?", rows)).toEqual([]);
    expect(matchDrives("Laat", rows)).toEqual([]);
  });

  it("bij een Drijfveer van 1-2 inhoudswoorden volstaat 1 gedeeld woord", () => {
    const short: DriveRow[] = [{ id: 4, kind: "wens", text: "Voetbal spelen", status: null }, { id: 5, kind: "wens", text: "Schaken", status: null }];
    expect(matchDrives("Zullen we voetbal kijken?", short).map((m) => m.driveId)).toEqual([4]);
    expect(matchDrives("Ik hou van schaken", short).map((m) => m.driveId)).toEqual([5]);
  });

  it("negeert gedropte en niet-actieve Drijfveren", () => {
    const inactive: DriveRow[] = [{ ...rows[1]!, droppedAt: new Date() }, { ...rows[2]!, status: "bereikt" }];
    expect(matchDrives("voetbal spelen en tekenen leren", inactive)).toEqual([]);
  });
});
