import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { EMBEDDING_DIMENSIONS, dreams, dynimos, memories } from "@animus/db/schema";
import { eq } from "drizzle-orm";
import { EMOTIONS } from "../src/emotion.js";
import { createAnimus } from "../src/index.js";
import { createTestDb, ensureOwner, truncateAll } from "./db.js";

const db = createTestDb();
const bornAt = new Date("2026-01-01T12:00:00.000Z");
const now = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

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
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 0 }])),
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

async function insertDynimo() {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5 })
    .returning();
  return row!;
}

// #94: de Spontane herinnering gaat enkel over aanwezigen (default de eigenaar); zonder eigen personId hoort een
// Herinnering hier bij de eigenaar, zodat deze tests (die geen aanwezig-signalen geven) blijven werken zoals voorheen.
// "personId" in over (i.p.v. over.personId ?? ...) zodat een expliciet meegegeven `null` ook echt null blijft.
async function insertMemory(dynimoId: number, over: Partial<typeof memories.$inferInsert> = {}) {
  const personId = "personId" in over ? over.personId : await ensureOwner(db);
  const [row] = await db
    .insert(memories)
    .values({ dynimoId, personId, text: "Gesprekspartner: ik ben ziek", embedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0), createdAt: new Date(now.getTime() - 7 * DAY), impression: 0.9, ...over })
    .returning();
  return row!;
}

function animusWith(model: MockLanguageModelV4, random: () => number) {
  return createAnimus({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random });
}

async function drain(events: AsyncIterable<unknown>) {
  for await (const _ of events) void _;
}

async function insertDream(dynimoId: number, over: Partial<typeof dreams.$inferInsert> = {}) {
  const [row] = await db
    .insert(dreams)
    .values({ dynimoId, text: "een trein door de wolken", emotion: "kalm", intensity: 0.6, createdAt: new Date(now.getTime() - DAY), ...over })
    .returning();
  return row!;
}

describe("Droom vertellen bij initiatief", () => {
  it("instrueert Type2 om een ongeziene Droom kort en associatief te vertellen", async () => {
    const dynimo = await insertDynimo();
    await insertDream(dynimo.id);

    const instruction = await animusWith(type2().model, () => 0).considerInitiative();

    expect(instruction).toContain("een trein door de wolken");
    expect(instruction).toContain("Ik droomde");
  });

  it("noemt geen Droom als de kans niet meezit", async () => {
    const dynimo = await insertDynimo();
    await insertDream(dynimo.id);

    expect(await animusWith(type2().model, () => 0.99).considerInitiative()).not.toContain("een trein door de wolken");
  });

  it("markeert de Droom pas na de beurt als verteld, en vertelt hem niet opnieuw", async () => {
    const dynimo = await insertDynimo();
    const dream = await insertDream(dynimo.id);
    const animus = animusWith(type2().model, () => 0);

    const instruction = await animus.considerInitiative();
    const [before] = await db.select().from(dreams).where(eq(dreams.id, dream.id));
    expect(before!.toldAt).toBeNull();

    await drain(animus.hear(instruction!, { initiatief: true }));

    await animus.settled();
    const [after] = await db.select().from(dreams).where(eq(dreams.id, dream.id));
    expect(after!.toldAt).toEqual(now);
    expect(await animus.considerInitiative()).not.toContain("een trein door de wolken");
  });

  it("geeft een Spontane herinnering voorrang: nooit beide in één initiatief-moment", async () => {
    const dynimo = await insertDynimo();
    const memory = await insertMemory(dynimo.id);
    const dream = await insertDream(dynimo.id);
    const animus = animusWith(type2().model, () => 0);

    const instruction = await animus.considerInitiative();
    expect(instruction).toContain("ik ben ziek");
    expect(instruction).not.toContain("een trein door de wolken");
    await drain(animus.hear(instruction!, { initiatief: true }));

    await animus.settled();
    const [d] = await db.select().from(dreams).where(eq(dreams.id, dream.id));
    const [m] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(d!.toldAt).toBeNull();
    expect(m!.lastRecalledAt).toEqual(now);
  });
});
