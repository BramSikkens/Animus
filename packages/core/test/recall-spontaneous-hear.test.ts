import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { EMBEDDING_DIMENSIONS, dynimos, memories } from "@animus/db/schema";
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

describe("Spontane herinnering bij initiatief", () => {
  it("geeft een geschikte Herinnering mee in de initiatief-instructie", async () => {
    const dynimo = await insertDynimo();
    await insertMemory(dynimo.id);

    const instruction = await animusWith(type2().model, () => 0).considerInitiative();

    expect(instruction).toContain("ik ben ziek");
  });

  it("noemt geen Herinnering als er geen geschikte is (te lage Indruk)", async () => {
    const dynimo = await insertDynimo();
    await insertMemory(dynimo.id, { impression: 0.2 });

    expect(await animusWith(type2().model, () => 0).considerInitiative()).not.toContain("ik ben ziek");
  });

  it("markeert de Herinnering pas na de beurt als aangehaald, en haalt hem daarna niet opnieuw aan", async () => {
    const dynimo = await insertDynimo();
    const memory = await insertMemory(dynimo.id);
    const animus = animusWith(type2().model, () => 0);

    const instruction = await animus.considerInitiative();
    const [before] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(before!.lastRecalledAt).toBeNull();

    await drain(animus.hear(instruction!, { initiatief: true }));

    await animus.settled();
    const [after] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(after!.lastRecalledAt).toEqual(now);
    expect(await animus.considerInitiative()).not.toContain("ik ben ziek");
  });
});

describe("Spontane herinnering in een normale beurt", () => {
  it("geeft de Herinnering als optionele aanleiding aan de systeem-prompt en markeert hem", async () => {
    const dynimo = await insertDynimo();
    const memory = await insertMemory(dynimo.id);
    const t2 = type2();
    const animus = animusWith(t2.model, () => 0);

    await drain(animus.hear("Hallo"));

    expect(t2.prompts[0]).toContain("ik ben ziek");
    await animus.settled();
    const [row] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(row!.lastRecalledAt).toEqual(now);
  });

  it("laat hem weg als de kans niet meezit", async () => {
    const dynimo = await insertDynimo();
    const memory = await insertMemory(dynimo.id);
    const t2 = type2();
    const animus = animusWith(t2.model, () => 0.99);

    await drain(animus.hear("Hallo"));

    // ook al is de tekst via recall() zelf al als herinnering beschikbaar: de aanleiding-prompt ontbreekt
    expect(t2.prompts[0]).not.toContain("Spontane herinnering");
    await animus.settled();
    const [row] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(row!.lastRecalledAt).toBeNull();
  });
});

describe("Spontane herinnering: geen query op het kritieke pad zonder kans", () => {
  // Telt hoeveel keer de Animus de kandidaten van de Spontane herinnering selecteert, met een Proxy om de db.
  async function selectCount(random: () => number) {
    const dynimo = await insertDynimo();
    await insertMemory(dynimo.id);
    let count = 0;
    const counting = new Proxy(db, { get: (target, prop, receiver) => (prop === "select" ? (...args: unknown[]) => (count += "lastRecalledAt" in ((args[0] as object) ?? {}) ? 1 : 0, (target.select as (...a: unknown[]) => unknown)(...args)) : Reflect.get(target, prop, receiver)) });
    const model = type2().model;
    const animus = createAnimus({ db: counting, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random });
    await drain(animus.hear("Hallo"));
    // De eind-Herinnering slaat op de achtergrond op (#109); afwachten vóórdat de test zelf meteen truncate't.
    await animus.settled();
    return count;
  }

  it("haalt de kandidaten pas op nadat de kansworp is geslaagd", async () => {
    expect(await selectCount(() => 0.99)).toBe(0);
    await truncateAll(db);
    expect(await selectCount(() => 0)).toBe(1);
  });
});

describe("Spontane herinnering en wisselen van Dynimo", () => {
  it("een voorbereide Spontane herinnering van de vorige Dynimo wordt niet alsnog gemarkeerd", async () => {
    const first = await insertDynimo();
    const memory = await insertMemory(first.id);
    const animus = animusWith(type2().model, () => 0);

    await animus.considerInitiative(); // zet pendingSpontaneousId voor `first`
    await db.update(dynimos).set({ awakeSince: null }).where(eq(dynimos.id, first.id));
    await db.insert(dynimos).values({ name: "Ben", coreCharacter: "Druk.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5 });
    await drain(animus.hear("Hoi", { initiatief: true }));

    await animus.settled();
    const [row] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(row!.lastRecalledAt).toBeNull();
  });
});
