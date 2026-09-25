import type Human from "@vladmandic/human";

// Zelfde @vladmandic/human-versie als in package.json (`pnpm ls @vladmandic/human`), gepind zoals MediaPipe hierboven.
const HUMAN_VERSION = "3.3.6";
// jsDelivr, gepind op dezelfde versie (research-doc: geen eigen modelhosting nodig voor deze fase).
const MODEL_BASE_PATH = `https://cdn.jsdelivr.net/npm/@vladmandic/human@${HUMAN_VERSION}/models/`;
// Moet gelijk zijn aan de bovengrens van Waarneming.aantal (packages/brain/src/perception.ts).
const MAX_FACES = 10;

type HumanInstance = InstanceType<typeof Human>;

// Eén Human-instantie voor de hele pagina (lazy, dynamische import zodat TFJS niet in de hoofdbundel zit); een
// mislukte load wordt gecachet zodat embed() daarna stil [] teruggeeft i.p.v. elke aanroep opnieuw te loggen.
let humanPromise: Promise<HumanInstance | null> | undefined;

async function loadHuman(): Promise<HumanInstance | null> {
  humanPromise ??= (async () => {
    try {
      const { default: HumanCtor } = await import("@vladmandic/human");
      const human = new HumanCtor({
        backend: "webgl",
        modelBasePath: MODEL_BASE_PATH,
        face: {
          enabled: true,
          detector: { maxDetected: MAX_FACES },
          // Alles wat standaard aan staat en hier niet nodig is, uit (research-doc: enkel detectie + description).
          mesh: { enabled: false },
          iris: { enabled: false },
          emotion: { enabled: false },
          description: { enabled: true },
        },
        body: { enabled: false },
        hand: { enabled: false },
        gesture: { enabled: false },
      });
      await human.load();
      return human;
    } catch (error) {
      console.error("Human (gezichts-embeddings) laden faalde:", error instanceof Error ? error.message : error);
      return null;
    }
  })();
  return humanPromise;
}

/**
 * Human-adapter (ADR-0020, #93): levert één gezichts-embedding per gedetecteerd gezicht. Faalt het laden, of gooit
 * de detectie zelf, dan geeft dit stil [] terug (console.error); de rest van de face-app werkt door.
 */
export async function embed(video: HTMLVideoElement): Promise<Float32Array[]> {
  const human = await loadHuman();
  if (!human) return [];
  try {
    const result = await human.detect(video);
    return result.face.filter((face) => face.embedding?.length).map((face) => new Float32Array(face.embedding!));
  } catch (error) {
    console.error("Gezichts-embeddings berekenen faalde:", error instanceof Error ? error.message : error);
    return [];
  }
}
