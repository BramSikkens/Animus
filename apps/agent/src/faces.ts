import { DEFAULT_FACE_MATCH_DISTANCE } from "@animus/core/perception";

/** Parseert FACE_MATCH_DISTANCE (L2-afstand, > 0); ongeldig geeft een waarschuwing (patroon: parseSpeakerMatchThreshold). */
export function parseFaceMatchDistance(value: string | undefined): { distance: number; warning?: string } {
  if (value === undefined || value.trim() === "") return { distance: DEFAULT_FACE_MATCH_DISTANCE };
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance <= 0) {
    return { distance: DEFAULT_FACE_MATCH_DISTANCE, warning: `FACE_MATCH_DISTANCE="${value}" is ongeldig; default ${DEFAULT_FACE_MATCH_DISTANCE}.` };
  }
  return { distance };
}

// Hoelang een gezicht-Waarneming meetelt voor inView()/present(): ruim boven het verzendinterval van de face-app
// (elke ~3s, zie apps/face/src/perception/face-send.ts), zodat een gemist bericht niet meteen "niemand" oplevert.
const IN_VIEW_MAX_AGE_MS = 7_000;
// Hoelang een onbekend gezicht onafgebroken in beeld moet zijn vóór het de initiatiefcheck "onbekend" uitlokt (#93).
const UNKNOWN_STABLE_MS = 5_000;

type Entry = { personId: number | null; at: number; aantal: number };

/**
 * Pure module (agent, #93, klok geïnjecteerd): houdt de recent binnengekomen gezicht-Waarnemingen bij (elk al
 * gematcht via animus.recognizeFaces) en leidt daaruit af wie er nu in beeld/aanwezig is, en of er een onbekend
 * gezicht stabiel genoeg in beeld is om de initiatiefcheck "onbekend" uit te lokken (eenmalig per onbekende reeks).
 */
export function createFaces() {
  const entries: Entry[] = [];
  // Tijd-/batchgebaseerd (niet: een reeks opeenvolgende berichten): een bekend gezicht ernaast (het hoofdscenario,
  // eigenaar + bezoeker) onderbreekt de onbekende-periode niet. Enkel een gat van ≥ IN_VIEW_MAX_AGE_MS zonder
  // ENIGE onbekende-Waarneming (dus ook geen kort "even weg") telt als verlopen en start een nieuwe periode.
  let unknownStreakStart: number | undefined;
  let lastUnknownAt: number | undefined;
  let unknownStreakReported = false;
  // #94 reviewfix: is er deze sessie ooit een gezicht-Waarneming binnengekomen (camera actief)? Blijft true ook als
  // entries() intussen door ouderdom leegloopt — dat betekent enkel "niemand nu in beeld", niet "geen camera".
  let everRecorded = false;

  return {
    /** Registreert het herkenningsresultaat van één gezicht-Waarneming (personId, of null = onbekend). */
    record(personId: number | null, at: number, aantal: number): void {
      everRecorded = true;
      entries.push({ personId, at, aantal });
      while (entries.length && at - entries[0]!.at > IN_VIEW_MAX_AGE_MS) entries.shift();
      // Een bekend gezicht raakt de onbekende-periode niet aan: het naast elkaar zien van eigenaar én bezoeker is
      // het hoofdscenario, geen onderbreking.
      if (personId !== null) return;
      if (lastUnknownAt === undefined || at - lastUnknownAt > IN_VIEW_MAX_AGE_MS) {
        unknownStreakStart = at;
        unknownStreakReported = false;
      }
      lastUnknownAt = at;
    },
    /** Personen (of null = onbekend) van de gezichten die nu in beeld zijn: hoogstens `aantal` van de laatste batch, nieuwste eerst. */
    inView(at: number): (number | null)[] {
      const recent = entries.filter((entry) => at - entry.at < IN_VIEW_MAX_AGE_MS);
      if (recent.length === 0) return [];
      const aantal = recent.at(-1)!.aantal;
      return recent
        .slice(-Math.max(aantal, 0))
        .reverse()
        .map((entry) => entry.personId);
    },
    /** Unieke bekende Personen die nu in beeld zijn. */
    present(at: number): number[] {
      const known = new Set<number>();
      for (const personId of this.inView(at)) if (personId !== null) known.add(personId);
      return [...known];
    },
    /**
     * True als er gedurende ≥ UNKNOWN_STABLE_MS een onbekend gezicht is gerapporteerd (ongeacht bekende gezichten
     * ernaast), met geen gat groter dan IN_VIEW_MAX_AGE_MS zonder een onbekende-Waarneming. Eenmalig per periode.
     */
    unknownStableSince(at: number): boolean {
      if (unknownStreakReported || unknownStreakStart === undefined || lastUnknownAt === undefined) return false;
      if (at - lastUnknownAt > IN_VIEW_MAX_AGE_MS) return false; // periode intussen verlopen door tijdsverloop
      if (at - unknownStreakStart < UNKNOWN_STABLE_MS) return false;
      unknownStreakReported = true;
      return true;
    },
    /** True zodra deze sessie minstens één gezicht-Waarneming binnenkwam (camera actief), ongeacht of iemand nu nog in beeld is. */
    seenAny(): boolean {
      return everRecorded;
    },
    /** Bij wissel/slapen (samen met perception.reset()). */
    reset(): void {
      entries.length = 0;
      unknownStreakStart = undefined;
      lastUnknownAt = undefined;
      unknownStreakReported = false;
      everRecorded = false;
    },
  };
}
