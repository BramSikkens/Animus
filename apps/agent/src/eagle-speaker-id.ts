import { Eagle, EagleProfiler } from "@picovoice/eagle-node";
import { bestMatch, type SpeakerId } from "./speaker-id.js";

export type EagleSpeakerIdDeps = {
  /** Nooit loggen (privacy/secrets-hygiëne): enkel uit env. */
  accessKey: string;
  /** Similarity-drempel (0–1) voor een "zekere" identificatie. */
  threshold: number;
  loadProfiles: () => Promise<{ personId: number; profile: Uint8Array }[]>;
  saveProfile: (personId: number, profile: Uint8Array) => Promise<void>;
};

function concatInt16(a: Int16Array, b: Int16Array): Int16Array {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

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
  const enrollments = new Map<number, { profiler: EagleProfiler; buffer: Int16Array }>();
  function enrollmentFor(personId: number): { profiler: EagleProfiler; buffer: Int16Array } {
    let entry = enrollments.get(personId);
    if (!entry) {
      entry = { profiler: new EagleProfiler(deps.accessKey), buffer: new Int16Array(0) };
      enrollments.set(personId, entry);
    }
    return entry;
  }

  return {
    identify(pcm) {
      if (profiles.length === 0) return null;
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
      if (percentage < 100) return "bezig";
      const exported = entry.profiler.export();
      entry.profiler.release();
      enrollments.delete(personId);
      await deps.saveProfile(personId, exported);
      await load();
      return "klaar";
    },
    reload: load,
    dispose() {
      eagle.release();
      for (const entry of enrollments.values()) entry.profiler.release();
      enrollments.clear();
    },
  };
}
