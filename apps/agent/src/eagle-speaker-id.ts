import { Eagle, EagleProfiler } from "@picovoice/eagle-node";
import { concatInt16, type Int16Buf } from "./pcm.js";
import { bestMatch, type SpeakerId } from "./speaker-id.js";

export type EagleSpeakerIdDeps = {
  /** Nooit loggen (privacy/secrets-hygiëne): enkel uit env. */
  accessKey: string;
  /** Similarity-drempel (0–1) voor een "zekere" identificatie. */
  threshold: number;
  loadProfiles: () => Promise<{ personId: number; profile: Uint8Array }[]>;
  saveProfile: (personId: number, profile: Uint8Array) => Promise<void>;
};

// Een enroll()-aanroep zonder voltooiing na zoveel beurten: de inschrijving wordt losgelaten (reset + release) en
// meldt "opgegeven", zodat de aanroeper stopt met deze Persoon als inschrijvend te behandelen (#107).
const MAX_ENROLL_TURNS_WITHOUT_COMPLETION = 10;

/**
 * Eagle-adapter achter de SpeakerId-interface (ADR-0020, #92). Bewaart nooit audio: enkel het door Eagle
 * geëxporteerde profiel gaat naar `saveProfile`. `reload()` ververst de geladen profielen (bv. na `enroll`
 * elders, of bij het opstarten); zonder een voorafgaande `reload()` identificeert `identify` niemand.
 */
export function createEagleSpeakerId(deps: EagleSpeakerIdDeps): SpeakerId {
  const eagle = new Eagle(deps.accessKey);
  let personIds: number[] = [];
  let profiles: Uint8Array[] = [];

  async function load(): Promise<void> {
    const rows = await deps.loadProfiles();
    personIds = rows.map((row) => row.personId);
    profiles = rows.map((row) => row.profile);
  }

  // ponytail: één lopende inschrijving per Persoon tegelijk; twee gelijktijdige enroll()-reeksen voor dezelfde
  // Persoon zouden elkaars buffer overschrijven. Niet nodig zolang de agent er hoogstens één per sessie voert.
  const enrollments = new Map<number, { profiler: EagleProfiler; buffer: Int16Buf; turnsWithoutCompletion: number }>();
  function enrollmentFor(personId: number): { profiler: EagleProfiler; buffer: Int16Buf; turnsWithoutCompletion: number } {
    let entry = enrollments.get(personId);
    if (!entry) {
      entry = { profiler: new EagleProfiler(deps.accessKey), buffer: new Int16Array(0), turnsWithoutCompletion: 0 };
      enrollments.set(personId, entry);
    }
    return entry;
  }

  return {
    identify(pcm) {
      // Te weinig samples: process() zelf zou hier op klappen (of geen zinnig resultaat geven); nooit de beurt breken.
      if (profiles.length === 0 || pcm.length < eagle.minProcessSamples) return null;
      const scores = eagle.process(pcm, profiles) as number[] | null; // de .d.ts mist de null-mogelijkheid uit de eigen docstring
      if (!scores) return null;
      return bestMatch({ scoresPerProfile: scores, profilePersonIds: personIds, threshold: deps.threshold });
    },
    async enroll(personId, pcm) {
      const entry = enrollmentFor(personId);
      let buffer = concatInt16(entry.buffer, pcm);
      let percentage = 0;
      while (buffer.length >= entry.profiler.frameLength) {
        percentage = entry.profiler.enroll(buffer.subarray(0, entry.profiler.frameLength));
        buffer = buffer.subarray(entry.profiler.frameLength);
      }
      entry.buffer = buffer;
      // Eén enroll()-aanroep is één beurt (één uiting, uit een apart deel van de audiostroom): flush() sluit hem
      // af vóór de volgende beurt begint, zoals het research-doc voorschrijft.
      percentage = Math.max(percentage, entry.profiler.flush());
      if (percentage >= 100) {
        const exported = entry.profiler.export();
        entry.profiler.release();
        enrollments.delete(personId);
        // Niet awaiten: "klaar" moet meteen teruggaan (de agent wist #enrollingPersonId dan meteen, vóór deze
        // achtergrondstappen), zodat er geen venster is waarin een nieuwe llmNode-aanroep een tweede profiler
        // voor dezelfde Persoon aanmaakt terwijl deze nog aan het opslaan/herladen is.
        void (async () => {
          try {
            await deps.saveProfile(personId, exported);
            await load();
          } catch (error) {
            console.warn("Stemprofiel opslaan/herladen faalde:", error instanceof Error ? error.message : error);
          }
        })();
        return "klaar";
      }
      entry.turnsWithoutCompletion++;
      if (entry.turnsWithoutCompletion >= MAX_ENROLL_TURNS_WITHOUT_COMPLETION) {
        entry.profiler.reset();
        entry.profiler.release();
        enrollments.delete(personId);
        return "opgegeven";
      }
      return "bezig";
    },
    reload: load,
    dispose() {
      eagle.release();
      for (const entry of enrollments.values()) entry.profiler.release();
      enrollments.clear();
    },
  };
}
