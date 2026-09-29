import sherpa from "sherpa-onnx-node";
import { bestMatch, type SpeakerId } from "./speaker-id.js";

export type SherpaSpeakerIdDeps = {
  modelPath: string;
  /** Similarity-drempel (0–1) voor een "zekere" identificatie. */
  threshold: number;
  loadProfiles: () => Promise<{ personId: number; profile: Uint8Array }[]>;
  saveProfile: (personId: number, profile: Uint8Array) => Promise<void>;
};

// ponytail: vaste ondergrenzen (1s identify, 3s enroll @ 16kHz), empirisch bijstellen.
const MIN_IDENTIFY_SAMPLES = 16_000;
const MIN_ENROLL_SAMPLES = 48_000;

// Een enroll()-aanroep zonder voltooiing na zoveel beurten: de inschrijving wordt losgelaten en meldt
// "opgegeven", zodat de aanroeper stopt met deze Persoon als inschrijvend te behandelen (#107).
const MAX_ENROLL_TURNS_WITHOUT_COMPLETION = 10;

/** Cosinus-similariteit tussen twee even lange vectoren; 1 = identiek, 0 = orthogonaal, -1 = tegengesteld. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Ruwe bytes van de embedding, zoals opgeslagen via saveProfile. */
function embeddingToBytes(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Leest een Float32-embedding terug uit opgeslagen bytes. Een binnenkomende Uint8Array kan een byteOffset hebben
 * die geen veelvoud van 4 is (bv. een Buffer uit Postgres) — daarom eerst kopiëren naar een uitgelijnde buffer.
 */
export function embeddingFromBytes(bytes: Uint8Array): Float32Array {
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer);
}

/**
 * sherpa-onnx-adapter achter de SpeakerId-interface (ADR-0020, #92). Bewaart nooit audio: enkel de door
 * SpeakerEmbeddingExtractor berekende embedding gaat naar `saveProfile`. `reload()` ververst de geladen
 * profielen (bv. na `enroll` elders, of bij het opstarten); zonder een voorafgaande `reload()` identificeert
 * `identify` niemand. Elke `enroll()`-aanroep is zijn eigen beurt (geen buffering over beurten heen, in
 * tegenstelling tot Eagle vroeger).
 */
export function createSherpaSpeakerId(deps: SherpaSpeakerIdDeps): SpeakerId {
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: deps.modelPath, numThreads: 1 });
  let personIds: number[] = [];
  let profiles: Float32Array[] = [];

  async function load(): Promise<void> {
    const rows = await deps.loadProfiles();
    personIds = rows.map((row) => row.personId);
    profiles = rows.map((row) => embeddingFromBytes(row.profile));
  }

  // ponytail: compute() is synchroon en blokkeert de event loop (~16ms per seconde audio, gemeten op macOS);
  // naar een worker_thread als een Pi-meting (fase 4) dat nodig maakt.
  function embeddingFor(pcm: Int16Array): Float32Array {
    const samples = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i]! / 32768;
    const stream = extractor.createStream();
    stream.acceptWaveform({ sampleRate: 16_000, samples });
    stream.inputFinished();
    return extractor.compute(stream);
  }

  const enrollments = new Map<number, number>(); // personId -> turnsWithoutCompletion

  return {
    identify(pcm) {
      if (profiles.length === 0 || pcm.length < MIN_IDENTIFY_SAMPLES) return null;
      const embedding = embeddingFor(pcm);
      const scores = profiles.map((profile) => cosineSimilarity(embedding, profile));

      // Beste score onafhankelijk van de drempel (voor live kalibratie); nooit audio of embeddings loggen.
      let bestIndex = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[bestIndex]!) bestIndex = i;
      console.log(`[stem] beste score ${scores[bestIndex]!.toFixed(3)} (Persoon ${personIds[bestIndex]}), drempel ${deps.threshold}`);

      return bestMatch({ scoresPerProfile: scores, profilePersonIds: personIds, threshold: deps.threshold });
    },
    async enroll(personId, pcm) {
      if (pcm.length < MIN_ENROLL_SAMPLES) {
        const turns = (enrollments.get(personId) ?? 0) + 1;
        if (turns >= MAX_ENROLL_TURNS_WITHOUT_COMPLETION) {
          enrollments.delete(personId);
          return "opgegeven";
        }
        enrollments.set(personId, turns);
        return "bezig";
      }
      enrollments.delete(personId);
      const exported = embeddingToBytes(embeddingFor(pcm));
      // Niet awaiten: "klaar" moet meteen teruggaan, zodat er geen venster is waarin een nieuwe llmNode-aanroep
      // een tweede voltooiing voor dezelfde Persoon start terwijl deze nog aan het opslaan/herladen is.
      void (async () => {
        try {
          await deps.saveProfile(personId, exported);
          await load();
        } catch (error) {
          console.warn("Stemprofiel opslaan/herladen faalde:", error instanceof Error ? error.message : error);
        }
      })();
      return "klaar";
    },
    reload: load,
    dispose() {
      // Geen release/free-methode in sherpa-onnx-node@1.13.8 (gecheckt in node_modules): enkel interne staat wissen.
      enrollments.clear();
      personIds = [];
      profiles = [];
    },
  };
}
