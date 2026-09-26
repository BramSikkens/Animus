import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { EMBEDDING_DIMENSIONS, dynimos } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { singleEmotionValues } from "../src/mood.js";
import { createBrain } from "../src/index.js";
import { createTestDb, truncateAll } from "./db.js";

const db = createTestDb();
const bornAt = new Date("2026-01-01T12:00:00.000Z");
const now = new Date("2026-06-15T12:00:00.000Z");

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

// Eén Type1 voor zowel de initiatief-check als de classificatie in hear().
const type1 = (blijScore = 4) =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
      const known: Record<string, { type: "choice"; choice: string } | { type: "score"; score: number }> = {
        spreken: { type: "choice", choice: "ja" },
        onderwerp: { type: "choice", choice: "vrij" },
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
        ...{ delta_blij: { type: "score" as const, score: blijScore } },
        indruk: { type: "score", score: 0.2 },
        intent: { type: "choice", choice: "simpel" },
      };
      return { answers: Object.fromEntries(questions.map((key) => [key, known[key]!])), warnings: [] };
    },
  });

const embedder = () =>
  new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }),
  });

// Legt de prompts vast die Type2 krijgt.
function type2() {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "1" },
            { type: "text-delta" as const, id: "1", delta: "Hoi!" },
            { type: "text-end" as const, id: "1" },
            { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
          ],
        }),
      };
    },
  });
  return { model, prompts };
}



async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5, ...extra })
    .returning();
  return row!;
}
async function hear(brain: ReturnType<typeof createBrain>, text: string, options?: { initiatief?: boolean }) {
  for await (const _ of brain.hear(text, options)) void _;
}
const brainWith = (model: MockLanguageModelV4, blijScore = 4, rng = 0.99) =>
  createBrain({ db, embedder: embedder(), type1: type1(blijScore), type2: { light: model, heavy: model }, now: () => now, random: () => rng });

describe("Vertrouwdheid in hear()", () => {
  it("stuurt de bandinstructie mee aan Type2", async () => {
    const row = await insertDynimo();
    await brainWith(type2().model).setFamiliarity(row.id, 0.9);
    const t2 = type2();
    await hear(brainWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("bijnamen");
  });

  it("een afstandelijke Dynimo (default) krijgt de afstandelijke instructie", async () => {
    await insertDynimo();
    const t2 = type2();
    await hear(brainWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("geen bijnamen");
  });

  it("laat Vertrouwdheid per beurt groeien", async () => {
    const row = await insertDynimo();
    const brain = brainWith(type2().model);
    await hear(brain, "Hoi");
    expect(await brain.familiarityOf(row.id)).toBeGreaterThan(0.2);
  });

  it("een spontane uiting (initiatief) telt niet als beurt", async () => {
    const row = await insertDynimo();
    const brain = brainWith(type2().model);
    await hear(brain, "Zeg iets", { initiatief: true });
    expect(await brain.familiarityOf(row.id)).toBe(0.2);
  });

  it("een positieve beurt (blij-delta, compliment) laat het meer groeien dan een gewone", async () => {
    const plain = await insertDynimo();
    const plainBrain = brainWith(type2().model);
    await hear(plainBrain, "Hoi");
    const plainValue = await plainBrain.familiarityOf(plain.id);
    // De eind-Herinnering slaat op de achtergrond op (#109); afwachten vóórdat hier meteen truncate't wordt.
    await plainBrain.settled();
    await truncateAll(db);
    const happy = await insertDynimo();
    const happyBrain = brainWith(type2().model, 6);
    await hear(happyBrain, "Wat ben je lief!");
    expect(await happyBrain.familiarityOf(happy.id)).toBeGreaterThan(plainValue);
  });

  it("een genegeerde beurt laat Vertrouwdheid dalen", async () => {
    const row = await insertDynimo({ axisTf: 0, axisReactivity: 1, moodValues: singleEmotionValues("boos", 0.9), moodAt: now });
    const brain = brainWith(type2().model, 4, 0);
    await brain.setFamiliarity(row.id, 0.5);
    await hear(brain, "Hallo daar");
    expect(await brain.familiarityOf(row.id)).toBeLessThan(0.5);
  });
});
