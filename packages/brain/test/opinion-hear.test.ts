import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { EMBEDDING_DIMENSIONS, drives, dynimos } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
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
const type1 = () =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
      const known: Record<string, { type: "choice"; choice: string } | { type: "score"; score: number }> = {
        spreken: { type: "choice", choice: "ja" },
        onderwerp: { type: "choice", choice: "vrij" },
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
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


async function setup(kind: string, text: string, axes: { axisTf: number; axisJp: number; axisExpressiveness: number }) {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisReactivity: 0.5, ...axes })
    .returning();
  await db.insert(drives).values({ dynimoId: row!.id, kind, text, status: kind === "doel" ? "actief" : null, createdAt: bornAt, updatedAt: bornAt });
  return row!;
}
const tJ = { axisTf: 0, axisJp: 0, axisExpressiveness: 1 };

async function hear(brain: ReturnType<typeof createBrain>, text: string) {
  let boos = 0;
  for await (const event of brain.hear(text)) if (event.type === "mood") boos = event.values.boos;
  return boos;
}

const brainWith = (model: MockLanguageModelV4) =>
  createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0 });

describe("Standpunt in hear()", () => {
  it("voegt bij een Ergernis-match een systeemregel toe en verhoogt boos via de bestaande delta's", async () => {
    await setup("ergernis", "mensen die te laat komen", tJ);
    const t2 = type2();
    const brain = brainWith(t2.model);

    const boos = await hear(brain, "Mijn vriend komt altijd te laat, mensen die laat komen");

    expect(t2.prompts[0]).toContain("Dit raakt aan je Ergernis");
    expect(boos).toBeGreaterThan(0);
  });

  it("geeft bij een Wens-match een enthousiaste voorkeur, zonder boos", async () => {
    await setup("wens", "voetbal spelen in een team", tJ);
    const t2 = type2();

    const boos = await hear(brainWith(t2.model), "Zullen we voetbal spelen?");

    expect(t2.prompts[0]).toContain("Dit raakt aan je Wens");
    expect(boos).toBe(0);
  });

  it("zonder match geen Standpunt", async () => {
    await setup("ergernis", "mensen die te laat komen", tJ);
    const t2 = type2();

    await hear(brainWith(t2.model), "Wat eten we vanavond?");

    expect(t2.prompts[0]).not.toContain("Dit raakt aan je");
  });

  it("cooldown: pas na vier beurten weer een Standpunt", async () => {
    await setup("ergernis", "mensen die te laat komen", tJ);
    const t2 = type2();
    const brain = brainWith(t2.model);

    for (let turn = 0; turn < 5; turn++) await hear(brain, "mensen die laat komen, zo vervelend");

    expect(t2.prompts.map((p) => p.includes("Dit raakt aan je"))).toEqual([true, false, false, false, true]);
  });

  it("cooldown geldt per Dynimo: na wisselen van Wakker Dynimo begint hij opnieuw", async () => {
    const first = await setup("ergernis", "mensen die te laat komen", tJ);
    const t2 = type2();
    const brain = brainWith(t2.model);

    await hear(brain, "mensen die laat komen, zo vervelend");
    await db.update(dynimos).set({ awakeSince: null }).where(eq(dynimos.id, first.id));
    await setup("ergernis", "mensen die te laat komen", tJ);
    await hear(brain, "mensen die laat komen, zo vervelend");

    expect(t2.prompts.map((p) => p.includes("Dit raakt aan je"))).toEqual([true, true]);
  });
});
