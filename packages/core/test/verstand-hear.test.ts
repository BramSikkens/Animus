import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { eq } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, dynimos } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createAnimus } from "../src/index.js";
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

async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5, ...extra })
    .returning();
  return row!;
}
const verstandOf = async (id: number) => (await db.select().from(dynimos).where(eq(dynimos.id, id)))[0]!.verstand;
async function hear(animus: ReturnType<typeof createAnimus>, text: string, options?: { initiatief?: boolean }) {
  for await (const _ of animus.hear(text, options)) void _;
}
const animusWith = (model: MockLanguageModelV4, rng = 0.99) =>
  createAnimus({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => rng });

describe("Verstand in hear()", () => {
  it("sterk-hoog Verstand geeft de sterk-hoog-tekst mee aan Type2", async () => {
    await insertDynimo({ verstand: 0.9 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("Je Verstand is groot");
  });

  it("midden Verstand (0.5) geeft geen enkele Verstand-tekst mee", async () => {
    await insertDynimo({ verstand: 0.5 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).not.toContain("Verstand is");
    expect(t2.prompts[0]).not.toContain("schrander");
  });

  it("leeg Verstand (null) geeft geen enkele Verstand-tekst mee", async () => {
    await insertDynimo();
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).not.toContain("Verstand is");
    expect(t2.prompts[0]).not.toContain("schrander");
  });

  it("sterk-laag Verstand geeft de sterk-laag-tekst mee aan Type2", async () => {
    await insertDynimo({ verstand: 0.1 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("Je Verstand is nog heel jong");
  });

  it("laag Verstand geeft de zachte laag-tekst mee aan Type2", async () => {
    await insertDynimo({ verstand: 0.3 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("Je weet nog niet zo veel van de wereld");
  });

  it("hoog Verstand geeft de zachte hoog-tekst mee, met een mening én een concreet voorbeeld", async () => {
    await insertDynimo({ verstand: 0.65 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("Je bent schrander");
    expect(t2.prompts[0]).toContain("concreet voorbeeld");
  });

  it("hoog Verstand + sterk F/P/N-assen vervangt de drie strijdige asregels en laat de oude tekst weg", async () => {
    await insertDynimo({ verstand: 0.65, axisTf: 0.9, axisJp: 0.9, axisSn: 0.9 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    const prompt = t2.prompts[0]!;
    expect(prompt).toContain("verzwijg geen waarheid");
    expect(prompt).toContain("kom bij een vraag altijd tot een duidelijk antwoord");
    expect(prompt).toContain("laat die beelden de feiten verhelderen");
    expect(prompt).not.toContain("kies zachte woorden boven harde waarheden");
    expect(prompt).not.toContain("hou opties open in plaats van te concluderen");
    expect(prompt).not.toContain("in plaats van feiten op te sommen");
  });

  it("midden Verstand met dezelfde sterke assen laat de oude regels ongewijzigd", async () => {
    await insertDynimo({ verstand: 0.5, axisTf: 0.9, axisJp: 0.9, axisSn: 0.9 });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    const prompt = t2.prompts[0]!;
    expect(prompt).toContain("kies zachte woorden boven harde waarheden");
    expect(prompt).toContain("hou opties open in plaats van te concluderen");
    expect(prompt).toContain("in plaats van feiten op te sommen");
  });

  it("hoog Verstand + sterk introvert laat de I↔E-lengteregel en de archetype-spreekstijl staan", async () => {
    await insertDynimo({ verstand: 0.65, axisIe: 0.1, archetype: "schattig-wezentje" });
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    const prompt = t2.prompts[0]!;
    expect(prompt).toContain("maximaal één korte zin");
    expect(prompt).toContain("verkleinwoorden");
  });

  it("setVerstand zet de waarde en geeft false bij een onbekende id", async () => {
    const row = await insertDynimo();
    const animus = animusWith(type2().model);
    expect(await animus.setVerstand(999999, 0.8)).toBe(false);
    expect(await animus.setVerstand(row.id, 0.8)).toBe(true);
    expect(await verstandOf(row.id)).toBe(0.8);
    const t2 = type2();
    await hear(animusWith(t2.model), "Hoi");
    expect(t2.prompts[0]).toContain("Je Verstand is groot");
  });
});
