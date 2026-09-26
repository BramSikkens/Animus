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

function light() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "1" },
          { type: "text-delta" as const, id: "1", delta: "Hoi." },
          { type: "text-end" as const, id: "1" },
          { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
        ],
      }),
    }),
  });
}

async function insertDynimo(emotion: "boos" | "blij") {
  await db.insert(dynimos).values({
    name: "Vero",
    coreCharacter: "Rustig.",
    birthStory: "Geboren.",
    seed: "z",
    bornAt,
    awakeSince: bornAt,
    axisIe: 0.5,
    axisSn: 0.5,
    axisTf: 0,
    axisJp: 0.5,
    axisReactivity: 1,
    axisExpressiveness: 1,
    moodValues: singleEmotionValues(emotion, 0.9),
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

const promptOf = (model: MockLanguageModelV4, call: number) => JSON.stringify(model.doStreamCalls[call]?.prompt);

describe("hear(): Emotie stuurt gedrag", () => {
  it("negeren: geen tekst en geen Type2-call, wel mood, geluid en een Herinnering", async () => {
    await insertDynimo("boos");
    const model = light();

    const brain = brainWith(model);
    const events = await collect(brain.hear("Hallo daar"));

    expect(events.map((event) => event.type)).toEqual(["mood", "sound"]);
    expect(events[1]).toEqual({ type: "sound", kind: "brommen" });
    expect(model.doStreamCalls).toHaveLength(0);
    await brain.settled();
    const stored = await db.select().from(memories);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toContain("Hallo daar");
    expect(stored[0]!.text).toContain("negeert");
  });

  it("negeert nooit twee beurten achter elkaar: de tweede is kort", async () => {
    await insertDynimo("boos");
    const model = light();
    const brain = brainWith(model);

    await collect(brain.hear("Een"));
    const second = await collect(brain.hear("Twee"));

    expect(second.some((event) => event.type === "text")).toBe(true);
    expect(promptOf(model, 0)).toContain("heel kort");
  });

  it("zeer blij: extra instructie voor een uitgebreid antwoord", async () => {
    await insertDynimo("blij");
    const model = light();

    await collect(brainWith(model).hear("Hallo"));

    expect(promptOf(model, 0)).toContain("uitgebreid");
  });

  it("initiatief wordt nooit genegeerd", async () => {
    await insertDynimo("boos");
    const model = light();

    const events = await collect(brainWith(model).hear("Begin een gesprek.", { initiatief: true }));

    expect(events.some((event) => event.type === "text")).toBe(true);
  });
});
