// Geheugen afgestemd op wie er aanwezig is (#94, ADR-0020): voorrang bij ophalen, discretieregel, Spontane
// herinnering enkel over aanwezigen, Reflectie-daling enkel voor afwezigen. "Aanwezig" = de aanwezig-optie plus de
// Gesprekspartner (als bekend); zonder beide de eigenaar (huidig gedrag).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { dynimos, EMBEDDING_DIMENSIONS, familiarities, memories, persons } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { SPONTANEOUS_MIN_AGE_MS } from "../src/recall-spontaneous.js";
import { createBrain } from "../src/index.js";
import { createTestDb, truncateAll } from "./db.js";

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

// Vector met één afwijkende waarde: samen met de vaste embedder hieronder geeft dat cosinusafstand 0 (een geldige,
// niet-gedegenereerde tie) voor elke Herinnering die exact deze embedding heeft.
const FIXED_VECTOR = (() => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = 1;
  return v;
})();

const embedder = () =>
  new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(() => FIXED_VECTOR), warnings: [] }),
  });

// Type1: spreken=ja (voor considerInitiative), verder neutraal.
const type1 = () =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
      const known: Record<string, { type: "choice"; choice: string } | { type: "score"; score: number }> = {
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
        indruk: { type: "score", score: 0.2 },
        intent: { type: "choice", choice: "simpel" },
        spreken: { type: "choice", choice: "ja" },
        onderwerp: { type: "choice", choice: "vrij" },
      };
      return { answers: Object.fromEntries(questions.map((key) => [key, known[key]!])), warnings: [] };
    },
  });

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

async function insertPerson(name: string) {
  const [row] = await db.insert(persons).values({ name }).returning();
  return row!;
}

async function insertMemory(dynimoId: number, over: Partial<typeof memories.$inferInsert> = {}) {
  const [row] = await db
    .insert(memories)
    .values({ dynimoId, text: "Herinnering", embedding: FIXED_VECTOR, createdAt: now, impression: 0.5, ...over })
    .returning();
  return row!;
}

function brainWith(model: MockLanguageModelV4, random: () => number = () => 0.99) {
  return createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random });
}

async function drain(events: AsyncIterable<unknown>) {
  for await (const _ of events) void _;
}

describe("recall: voorrang voor de aanwezige Persoon (#94)", () => {
  it("bij gelijke relevantie wint de aanwezige Persoon; de afwezige blijft ophaalbaar als er plaats is", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna"); // aanwezig
    const bram = await insertPerson("Bram"); // afwezig
    // Bram eerst ingevoegd: zonder de bonus zou een tie op afstand hem als eerste (of onvoorspelbaar) teruggeven.
    await insertMemory(vero.id, { personId: bram.id, text: "Bram-herinnering" });
    await insertMemory(vero.id, { personId: anna.id, text: "Anna-herinnering" });
    const t2 = type2();
    const brain = brainWith(t2.model);

    await drain(brain.hear("Hoi", { aanwezig: [anna.id] }));

    const prompt = t2.prompts[0]!;
    expect(prompt).toContain("Anna-herinnering");
    expect(prompt).toContain("Bram-herinnering"); // nog steeds opgehaald, geen harde muur
    expect(prompt.indexOf("Anna-herinnering")).toBeLessThan(prompt.indexOf("Bram-herinnering"));
  });
});

describe("discretieregel in recall() (#94)", () => {
  it("krijgt de regel en de naam als een opgehaalde Herinnering bij een andere Persoon hoort dan de Gesprekspartner", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    await insertMemory(vero.id, { personId: anna.id, text: "Anna-geheim" });
    const t2 = type2();
    const brain = brainWith(t2.model);

    await drain(brain.hear("Hoi")); // Gesprekspartner = eigenaar (default), dus Anna is "een ander"

    expect(t2.prompts[0]).toContain("Sommige herinneringen komen uit gesprekken met anderen");
    expect(t2.prompts[0]).toContain("(met Anna)");
  });

  it("blijft weg als alle opgehaalde Herinneringen van de Gesprekspartner zijn of zonder Persoon", async () => {
    const vero = await insertDynimo();
    await insertMemory(vero.id, { personId: null, text: "Onbekende-herinnering" });
    const t2 = type2();
    const brain = brainWith(t2.model);

    await drain(brain.hear("Hoi", { gesprekspartner: { soort: "onbekend" } }));

    expect(t2.prompts[0]).not.toContain("Sommige herinneringen komen uit gesprekken met anderen");
  });
});

describe("Spontane herinnering enkel over aanwezigen (#94)", () => {
  const OLD = new Date(now.getTime() - SPONTANEOUS_MIN_AGE_MS - DAY);

  it("considerInitiative: een Herinnering van een afwezige Persoon wordt nooit spontaan gekozen", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna"); // aanwezig
    const bram = await insertPerson("Bram"); // afwezig
    await insertMemory(vero.id, { personId: bram.id, text: "bram-geheim", impression: 0.9, createdAt: OLD });
    const brain = brainWith(type2().model, () => 0);

    const instruction = await brain.considerInitiative(undefined, { aanwezig: [anna.id] });

    expect(instruction).not.toContain("bram-geheim");
  });

  it("considerInitiative: een Herinnering van een aanwezige Persoon wordt wel spontaan gekozen", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    await insertMemory(vero.id, { personId: anna.id, text: "anna-geheim", impression: 0.9, createdAt: OLD });
    const brain = brainWith(type2().model, () => 0);

    const instruction = await brain.considerInitiative(undefined, { aanwezig: [anna.id] });

    expect(instruction).toContain("anna-geheim");
  });

  it("een Herinnering zonder Persoon wordt nooit spontaan gekozen", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    await insertMemory(vero.id, { personId: null, text: "niemands-geheim", impression: 0.9, createdAt: OLD });
    const brain = brainWith(type2().model, () => 0);

    const instruction = await brain.considerInitiative(undefined, { aanwezig: [anna.id] });

    expect(instruction).not.toContain("niemands-geheim");
  });

  it("hear() in een gewone beurt: filtert ook op de aanwezig-optie van die beurt", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const bram = await insertPerson("Bram");
    await insertMemory(vero.id, { personId: bram.id, text: "bram-geheim", impression: 0.9, createdAt: OLD });
    const t2 = type2();
    const brain = brainWith(t2.model, () => 0);

    await drain(brain.hear("Hoi", { aanwezig: [anna.id] }));

    expect(t2.prompts[0]).not.toContain("Spontane herinnering");
  });
});

describe("privacy-reviewfix: geen impliciete eigenaar-fallback bij een expliciet signaal (#94)", () => {
  const OLD = new Date(now.getTime() - SPONTANEOUS_MIN_AGE_MS - DAY);

  it("een onbekende Gesprekspartner zonder aanwezig-optie krijgt geen Spontane herinnering van de eigenaar", async () => {
    const vero = await insertDynimo();
    await drain(brainWith(type2().model).hear("Hoi")); // creëert de eigenaar-rij
    const owner = (await db.select().from(persons).where(eq(persons.owner, true)))[0]!;
    await insertMemory(vero.id, { personId: owner.id, text: "eigenaar-geheim", impression: 0.9, createdAt: OLD });
    const t2 = type2();
    const brain = brainWith(t2.model, () => 0); // rng 0: de kansworp voor de Spontane herinnering slaagt altijd

    await drain(brain.hear("Hoi", { gesprekspartner: { soort: "onbekend" } }));

    // recall() zelf kent geen muur (eigenaar-geheim mag via een gewone Herinnering nog ophaalbaar zijn); enkel de
    // Spontane herinnering (die wél op aanwezigen filtert) mag hem niet aanhalen.
    expect(t2.prompts[0]).not.toContain("Spontane herinnering");
  });

  it("considerInitiative met aanwezig: [] kiest geen Spontane herinnering van de eigenaar", async () => {
    const vero = await insertDynimo();
    await drain(brainWith(type2().model).hear("Hoi")); // creëert de eigenaar-rij
    const owner = (await db.select().from(persons).where(eq(persons.owner, true)))[0]!;
    await insertMemory(vero.id, { personId: owner.id, text: "eigenaar-geheim", impression: 0.9, createdAt: OLD });
    const brain = brainWith(type2().model, () => 0);

    const instruction = await brain.considerInitiative(undefined, { aanwezig: [] });

    expect(instruction).not.toContain("eigenaar-geheim");
  });
});

describe("Reflectie-daling enkel voor afwezigen (#94)", () => {
  const reflectionResult = {
    evolvedCharacter: "Rustig.",
    axisShifts: { ie: 0, sn: 0, tf: 0, jp: 0, reactivity: 0, expressiveness: 0 },
    verstandShift: 0,
    drives: { add: [], closeGoals: [], drop: [] },
    wakeMood: { emotion: "kalm", intensity: 0.4 },
    dream: null,
  };
  const heavy = () =>
    new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: JSON.stringify(reflectionResult) }],
        finishReason: STOP,
        usage: NULL_USAGE,
        warnings: [],
      }),
    });

  it("slaat de Persoon die aanwezig was over; wie afwezig was daalt zoals nu", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const bram = await insertPerson("Bram");
    await db.insert(familiarities).values([
      { dynimoId: vero.id, personId: anna.id, familiarity: 0.5 },
      { dynimoId: vero.id, personId: bram.id, familiarity: 0.5 },
    ]);
    await insertMemory(vero.id); // reflect() past enkel iets toe als er nieuwe Herinneringen zijn
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: type2().model, heavy: heavy() }, now: () => now, random: () => 0.99 });

    expect(await brain.reflect({ aanwezig: [anna.id] })).toBe(true);

    expect(await brain.familiarityOf(vero.id, anna.id)).toBe(0.5); // aanwezig: ongemoeid
    expect(await brain.familiarityOf(vero.id, bram.id)).toBeLessThan(0.5); // afwezig: gedaald
  });
});
