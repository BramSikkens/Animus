import { describe, expect, it, vi } from "vitest";

// Native sherpa-onnx-node vervangen: een extractor die altijd hetzelfde compute()-resultaat geeft, zodat
// enroll()-inschrijvingen nooit "vanzelf" klaar zijn (te korte PCM is genoeg om dat te forceren).
vi.mock("sherpa-onnx-node", () => ({
  default: {
    SpeakerEmbeddingExtractor: class {
      dim = 2;
      createStream() {
        return { acceptWaveform: () => {}, inputFinished: () => {} };
      }
      isReady(): boolean {
        return true;
      }
      compute(): Float32Array {
        return new Float32Array([1, 0]);
      }
    },
  },
}));

const { createSherpaSpeakerId, cosineSimilarity, embeddingFromBytes } = await import("./sherpa-speaker-id.js");

describe("cosineSimilarity", () => {
  it("identieke vectoren geven 1", () => {
    expect(cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBeCloseTo(1);
  });

  it("orthogonale vectoren geven 0", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
  });

  it("tegengestelde vectoren geven -1", () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([-1, -2]))).toBeCloseTo(-1);
  });

  it("is schaal-onafhankelijk", () => {
    const a = new Float32Array([1, 2, 3]);
    const scaled = new Float32Array([2, 4, 6]);
    expect(cosineSimilarity(a, scaled)).toBeCloseTo(cosineSimilarity(a, a));
  });
});

describe("embeddingFromBytes", () => {
  it("leest een Float32-embedding terug uit een Uint8Array-view met een niet-uitgelijnde byteOffset", () => {
    const embedding = new Float32Array([0.5, -1.25, 3]);
    // Onderliggende buffer groter en met een offset die geen veelvoud van 4 is (zoals een Buffer uit Postgres).
    const underlying = new ArrayBuffer(embedding.byteLength + 5);
    new Uint8Array(underlying, 1, embedding.byteLength).set(new Uint8Array(embedding.buffer));
    const misaligned = new Uint8Array(underlying, 1, embedding.byteLength);

    expect(Array.from(embeddingFromBytes(misaligned))).toEqual(Array.from(embedding));
  });
});

describe("createSherpaSpeakerId.enroll", () => {
  it("meldt 'opgegeven' (niet 'bezig') als de inschrijving na 10 beurten zonder voltooiing losgelaten wordt (#107)", async () => {
    const speakerId = createSherpaSpeakerId({ modelPath: "x", threshold: 0.5, loadProfiles: async () => [], saveProfile: async () => {} });
    const statuses: string[] = [];
    for (let turn = 0; turn < 10; turn++) statuses.push(await speakerId.enroll(7, new Int16Array(4)));

    expect(statuses.slice(0, 9)).toEqual(new Array(9).fill("bezig"));
    expect(statuses[9]).toBe("opgegeven");
  });

  it("een uiting van minstens 3s (48000 samples) meldt 'klaar' en slaat het profiel op", async () => {
    const saveProfile = vi.fn(async () => {});
    const speakerId = createSherpaSpeakerId({ modelPath: "x", threshold: 0.5, loadProfiles: async () => [], saveProfile });
    const status = await speakerId.enroll(7, new Int16Array(48_000));
    expect(status).toBe("klaar");
    // saveProfile draait op de achtergrond (niet geawaited door enroll zelf): even wachten tot de microtask-queue leeg is.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveProfile).toHaveBeenCalledWith(7, expect.any(Uint8Array));
  });
});

describe("createSherpaSpeakerId.identify", () => {
  it("geeft null zonder geladen profielen", () => {
    const speakerId = createSherpaSpeakerId({ modelPath: "x", threshold: 0.5, loadProfiles: async () => [], saveProfile: async () => {} });
    expect(speakerId.identify(new Int16Array(16_000))).toBeNull();
  });

  it("geeft null bij minder dan 1s audio, zelfs met geladen profielen", async () => {
    const speakerId = createSherpaSpeakerId({
      modelPath: "x",
      threshold: 0.5,
      loadProfiles: async () => [{ personId: 1, profile: new Uint8Array(new Float32Array([1, 0]).buffer) }],
      saveProfile: async () => {},
    });
    await speakerId.reload();
    expect(speakerId.identify(new Int16Array(8_000))).toBeNull();
  });

  it("matcht tegen een geladen profiel boven de drempel", async () => {
    const speakerId = createSherpaSpeakerId({
      modelPath: "x",
      threshold: 0.5,
      loadProfiles: async () => [{ personId: 1, profile: new Uint8Array(new Float32Array([1, 0]).buffer) }],
      saveProfile: async () => {},
    });
    await speakerId.reload();
    expect(speakerId.identify(new Int16Array(16_000))).toEqual({ personId: 1, score: 1 });
  });
});
