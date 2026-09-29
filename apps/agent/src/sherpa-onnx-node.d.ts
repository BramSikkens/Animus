// Geen typings voor sherpa-onnx-node: minimale ambient declaratie voor enkel wat sherpa-speaker-id.ts gebruikt.
declare module "sherpa-onnx-node" {
  export type OnlineStream = {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
    inputFinished(): void;
  };

  export class SpeakerEmbeddingExtractor {
    constructor(config: { model: string; numThreads?: number });
    dim: number;
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    compute(stream: OnlineStream): Float32Array;
  }

  const sherpa: { SpeakerEmbeddingExtractor: typeof SpeakerEmbeddingExtractor };
  export default sherpa;
}
