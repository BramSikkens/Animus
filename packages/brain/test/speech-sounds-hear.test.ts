import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { EMBEDDING_DIMENSIONS, dynimos, memories } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain, type BrainEvent } from "../src/index.js";
import { singleEmotionValues } from "../src/mood.js";
import { createTestDb, truncateAll } from "./db.js";

const db = createTestDb();
const bornAt = new Date("2026-01-01T12:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$client.end();
});

const NULL_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const STOP: { unified: "stop"; raw: undefined } = { unified: "stop", raw: undefined };

const type1 = () =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: async () => ({
      answers: {
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 10 }])),
        indruk: { type: "score" as const, score: 0.2 },
        intent: { type: "choice" as const, choice: "simpel" },
      },
      warnings: [],
    }),
  });

const embedder = () =>
  new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }),
  });

const REPLY = "Wat leuk dat je er bent, vertel me alles!";

function light() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "1" },
          { type: "text-delta" as const, id: "1", delta: REPLY.slice(0, 5) },
          { type: "text-delta" as const, id: "1", delta: REPLY.slice(5) },
          { type: "text-end" as const, id: "1" },
          { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
        ],
      }),
    }),
  });
}

async function insertDynimo(emotion: "blij" | "droevig" | "boos", value = 0.9) {
  await db.insert(dynimos).values({
    name: "Vero",
    coreCharacter: "Rustig.",
    birthStory: "Geboren.",
    seed: "z",
    bornAt,
    awakeSince: bornAt,
    axisIe: 0.5,
    axisSn: 0.5,
    axisTf: 0.5,
    axisJp: 0.5,
    axisReactivity: 1,
    axisExpressiveness: 1,
    moodValues: singleEmotionValues(emotion, value),
    moodAt: bornAt,
  });
}

function brainWith(model: MockLanguageModelV4) {
  return createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => bornAt, random: () => 0 });
}

async function collect(events: AsyncIterable<BrainEvent>) {
  const all: BrainEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}


const textOf = (events: BrainEvent[]) => events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");

describe("hear(): Spraakgeluiden", () => {
  it("zet een geluid vóór de tekst richting TTS, maar bewaart de schone tekst in de Herinnering", async () => {
    await insertDynimo("blij");

    const brain = brainWith(light());
    const events = await collect(brain.hear("Hallo"));

    expect(textOf(events)).toBe(`ha ha ${REPLY}`);
    await brain.settled();
    const stored = await db.select().from(memories);
    expect(stored[0]!.text).toContain(REPLY);
    expect(stored[0]!.text).not.toContain("ha ha");
  });

  it("herhaalt hetzelfde geluid niet twee beurten achter elkaar", async () => {
    await insertDynimo("blij");
    const brain = brainWith(light());

    await collect(brain.hear("Een"));
    const second = await collect(brain.hear("Twee"));

    expect(textOf(second)).toBe(REPLY);
  });
});

describe("hear(): latentie", () => {
  it("levert geluid en eerste tekst direct, zonder te wachten op verdere tokens", async () => {
    await insertDynimo("blij");
    // Stream die na twee tokens nooit meer iets geeft: alles wat uitkomt, kwam dus zonder wachten uit.
    const hanging = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start" as const, warnings: [] });
            controller.enqueue({ type: "text-start" as const, id: "1" });
            controller.enqueue({ type: "text-delta" as const, id: "1", delta: "Hoi" });
            controller.enqueue({ type: "text-delta" as const, id: "1", delta: " daar," });
          },
        }),
      }),
    });
    const iterator = brainWith(hanging).hear("Hallo")[Symbol.asyncIterator]();

    const texts: BrainEvent[] = [];
    while (texts.length < 3) {
      const { value } = await iterator.next();
      if (value.type === "text") texts.push(value);
    }
    await iterator.return?.();

    expect(texts).toEqual([
      { type: "text", delta: "ha ha " },
      { type: "text", delta: "Hoi" },
      { type: "text", delta: " daar," },
    ]);
  });
});

describe("hear(): spraakpauzes", () => {
  const TWO = "Wat leuk dat je er bent, vertel me alles over jezelf. Ik ben zo benieuwd naar je! Echt waar.";
  const twoSentences = () =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "1" },
            ...TWO.match(/[^]{1,9}/g)!.map((delta) => ({ type: "text-delta" as const, id: "1", delta })),
            { type: "text-end" as const, id: "1" },
            { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
          ],
        }),
      }),
    });

  it("zet pauzes in de TTS-tekst maar bewaart de schone tekst", async () => {
    await insertDynimo("droevig");
    const brain = brainWith(twoSentences());
    const events = await collect(brain.hear("Hallo"));

    expect(textOf(events)).not.toContain("jezelf. …"); // eerste zin zonder pauze
    expect(textOf(events)).toContain("naar je! … Echt");
    await brain.settled();
    const stored = await db.select().from(memories);
    expect(stored[0]!.text).toContain(TWO);
    expect(stored[0]!.text).not.toContain("…");
  });

  it("laat de tekst ongemoeid bij een emotie zonder pauzes", async () => {
    // boos heeft geen pauzes en geen Spraakgeluid; laag genoeg om niet te negeren.
    await insertDynimo("boos", 0.3);
    const events = await collect(brainWith(twoSentences()).hear("Hallo"));

    expect(textOf(events)).toBe(TWO);
  });
});
