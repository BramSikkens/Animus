import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { dynimos, EMBEDDING_DIMENSIONS, faceEmbeddings, memories, persons } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain } from "../src/index.js";
import { createTestDb, truncateAll } from "./db.js";

const db = createTestDb();
beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$client.end();
});

const bornAt = new Date("2026-01-01T12:00:00.000Z");
const now = new Date("2026-06-15T12:00:00.000Z");

const NULL_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const STOP: { unified: "stop"; raw: undefined } = { unified: "stop", raw: undefined };
const TOOL_CALLS: { unified: "tool-calls"; raw: undefined } = { unified: "tool-calls", raw: undefined };

const embedder = () =>
  new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }),
  });

const type1 = () =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
      const known: Record<string, { type: "choice"; choice: string } | { type: "score"; score: number }> = {
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
        indruk: { type: "score", score: 0.2 },
        intent: { type: "choice", choice: "simpel" },
        spreken: { type: "choice", choice: "nee" },
        onderwerp: { type: "choice", choice: "vrij" },
      };
      return { answers: Object.fromEntries(questions.map((key) => [key, known[key]!])), warnings: [] };
    },
  });

function textModel(text = "Hoi!") {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "1" },
          { type: "text-delta" as const, id: "1", delta: text },
          { type: "text-end" as const, id: "1" },
          { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
        ],
      }),
    }),
  });
}

function toolThenTextModel(toolName: string, input: object, answer: string) {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "tool-call" as const, toolCallId: "call-1", toolName, input: JSON.stringify(input) },
            { type: "finish" as const, usage: NULL_USAGE, finishReason: TOOL_CALLS },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "1" },
            { type: "text-delta" as const, id: "1", delta: answer },
            { type: "text-end" as const, id: "1" },
            { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
          ],
        }),
      },
    ],
  });
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

async function drain(events: AsyncIterable<unknown>) {
  for await (const _ of events) void _;
}

// Vectoren met 1023 nullen en één afwijkende waarde op index 0: de L2-afstand tussen twee zulke vectoren is
// gewoon |a - b|, wat de testen voorspelbaar maakt zonder de echte Human-embeddings na te bootsen.
const EMBEDDING_LENGTH = 1024;
function vectorAt(value: number): number[] {
  const v = new Array<number>(EMBEDDING_LENGTH).fill(0);
  v[0] = value;
  return v;
}

describe("recognizeFaces (#93)", () => {
  it("matcht een embedding binnen de drempel aan de Persoon", async () => {
    const anna = await insertPerson("Anna");
    await db.insert(faceEmbeddings).values({ personId: anna.id, embedding: vectorAt(0) });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.99, faceMatchDistance: 10 });

    const result = await brain.recognizeFaces([vectorAt(5)]); // afstand 5 < 10
    expect(result).toEqual([anna.id]);
  });

  it("geeft null voor een embedding buiten de drempel", async () => {
    const anna = await insertPerson("Anna");
    await db.insert(faceEmbeddings).values({ personId: anna.id, embedding: vectorAt(0) });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.99, faceMatchDistance: 10 });

    const result = await brain.recognizeFaces([vectorAt(20)]); // afstand 20 > 10
    expect(result).toEqual([null]);
  });

  it("geeft null zonder enige opgeslagen embedding", async () => {
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.99, faceMatchDistance: 10 });
    expect(await brain.recognizeFaces([vectorAt(0)])).toEqual([null]);
  });

  it("< 5 embeddings: een zekere match voegt toe (geen vervanging)", async () => {
    const anna = await insertPerson("Anna");
    await insertDynimo();
    await db.insert(faceEmbeddings).values({ personId: anna.id, embedding: vectorAt(0) });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0, faceMatchDistance: 10 });

    await brain.recognizeFaces([vectorAt(1)]);

    const rows = await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id));
    expect(rows).toHaveLength(2);
  });

  it("op 5 embeddings: vervangt de oudste enkel als random() < FACE_REPLACE_PROBABILITY", async () => {
    const anna = await insertPerson("Anna");
    await insertDynimo();
    for (let i = 0; i < 5; i++) await db.insert(faceEmbeddings).values({ personId: anna.id, embedding: vectorAt(i) });

    // random() net te hoog: geen vervanging.
    const brainNoReplace = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.06, faceMatchDistance: 10 });
    await brainNoReplace.recognizeFaces([vectorAt(4)]);
    expect(await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id))).toHaveLength(5);

    // random() onder de kans: de oudste (index 0) wordt vervangen.
    const brainReplace = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.01, faceMatchDistance: 10 });
    await brainReplace.recognizeFaces([vectorAt(4)]);
    const rows = await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.embedding[0])).not.toContain(0);
  });

  it("onthoudt een onbekende embedding in de sessie zodat leerKennen hem kan koppelen", async () => {
    await insertDynimo();
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: toolThenTextModel("leerKennen", { naam: "Bert" }, "Hoi Bert!"), heavy: textModel() }, now: () => now, random: () => 0.99, faceMatchDistance: 10 });

    await brain.recognizeFaces([vectorAt(50)]); // ver van niets: onbekend
    await drain(brain.hear("Ik heet Bert", { gesprekspartner: null }));

    const bert = (await db.select().from(persons).where(eq(persons.name, "Bert")))[0]!;
    const linked = await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, bert.id));
    expect(linked).toHaveLength(1);
    expect(linked[0]!.embedding[0]).toBeCloseTo(50, 5);
  });

  it("koppelt een onbekende embedding niet meer na de vervaltijd (15s)", async () => {
    await insertDynimo();
    let clock = now;
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: toolThenTextModel("leerKennen", { naam: "Bert" }, "Hoi Bert!"), heavy: textModel() }, now: () => clock, random: () => 0.99, faceMatchDistance: 10 });

    await brain.recognizeFaces([vectorAt(50)]);
    clock = new Date(now.getTime() + 15_001);
    await drain(brain.hear("Ik heet Bert", { gesprekspartner: null }));

    const bert = (await db.select().from(persons).where(eq(persons.name, "Bert")))[0]!;
    expect(await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, bert.id))).toHaveLength(0);
  });

  it("onthoudt hoogstens de laatste 3 onbekende embeddings van de sessie", async () => {
    await insertDynimo();
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: toolThenTextModel("leerKennen", { naam: "Bert" }, "Hoi Bert!"), heavy: textModel() }, now: () => now, random: () => 0.99, faceMatchDistance: 10 });

    await brain.recognizeFaces([vectorAt(1), vectorAt(2), vectorAt(3), vectorAt(4), vectorAt(5), vectorAt(6)]);
    await drain(brain.hear("Ik heet Bert", { gesprekspartner: null }));

    const bert = (await db.select().from(persons).where(eq(persons.name, "Bert")))[0]!;
    const linked = await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, bert.id));
    expect(linked).toHaveLength(3); // MAX_UNKNOWN_FACE_EMBEDDINGS: enkel de 3 meest recente
    expect(linked.map((row) => row.embedding[0]!).sort((a, b) => a - b)).toEqual([4, 5, 6]);
  });

  it("adopteert de wakkere Dynimo (resetSession bij wissel wist het niet meteen)", async () => {
    // Regressie: recognizeFaces zonder eerst adopt() zou de onbekende-buffer voor niets vullen als de eerstvolgende
    // hear()/considerInitiative()-aanroep de sessie alsnog reset (nieuwe awake-generatie).
    const vero = await insertDynimo();
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: toolThenTextModel("leerKennen", { naam: "Bert" }, "Hoi Bert!"), heavy: textModel() }, now: () => now, random: () => 0.99, faceMatchDistance: 10 });

    await brain.recognizeFaces([vectorAt(50)]);
    await drain(brain.hear("Ik heet Bert", { gesprekspartner: null }));

    const bert = (await db.select().from(persons).where(eq(persons.name, "Bert")))[0]!;
    expect(await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, bert.id))).toHaveLength(1);
    void vero;
  });
});

describe("aanwezig-regel in hear() (#93)", () => {
  it("zonder aanwezig-optie: geen regel", async () => {
    await insertDynimo();
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99 });
    await drain(brain.hear("Hoi"));
    expect(prompts[0]).not.toContain("Aanwezig:");
  });

  it("met aanwezig: eigenaar als 'je eigenaar', bekende Personen bij naam, onbekende ids overgeslagen", async () => {
    const owner = await insertDynimo().then(async () => {
      const brain0 = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.99 });
      await drain(brain0.hear("Hoi")); // maakt de eigenaar-rij aan
      return (await db.select().from(persons).where(eq(persons.owner, true)))[0]!;
    });
    const anna = await insertPerson("Anna");
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99 });
    await drain(brain.hear("Hoi", { aanwezig: [owner.id, anna.id, 999_999] }));

    expect(prompts[0]).toContain("Aanwezig:");
    expect(prompts[0]).toContain("je eigenaar");
    expect(prompts[0]).toContain("Anna");
  });

  it("aanwezig zonder geldige ids: geen regel", async () => {
    await insertDynimo();
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99 });
    await drain(brain.hear("Hoi", { aanwezig: [999_999] }));
    expect(prompts[0]).not.toContain("Aanwezig:");
  });
});
