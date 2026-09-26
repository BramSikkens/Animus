// #114: één sessie-object per Wakker-generatie. Bij een wissel van Dynimo mag een nog lopende beurt van A niet in
// het Werkgeheugen of de sessielijsten van B schrijven.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { eq } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, dynimos, memories, persons } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain } from "../src/index.js";
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
const TOOL_CALLS: { unified: "tool-calls"; raw: undefined } = { unified: "tool-calls", raw: undefined };

// Neutraal: geen delta's, simpel, geen negeren/kort — een gewone beurt die de LLM bereikt.
const type1 = () =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
      const known: Record<string, { type: "score"; score: number } | { type: "choice"; choice: string }> = {
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
        indruk: { type: "score", score: 0.2 },
        intent: { type: "choice", choice: "simpel" },
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


async function insertDynimo(name: string, awakeSince: Date | null) {
  const [row] = await db
    .insert(dynimos)
    .values({
      name,
      coreCharacter: "Rustig.",
      birthStory: "Geboren.",
      seed: "z",
      bornAt,
      awakeSince,
      baseEmotion: "kalm",
      axisIe: 0.5,
      axisSn: 0.5,
      axisTf: 0.5,
      axisJp: 0.5,
      axisReactivity: 0.3,
      axisExpressiveness: 0.5,
    })
    .returning();
  return row!;
}

async function drain(events: AsyncIterable<unknown>) {
  for await (const _ of events) void _;
}

describe("Eén sessie-object per Wakker-generatie (#114)", () => {
  it("A's nog lopende beurt na een wissel naar B belandt niet in B's Werkgeheugen", async () => {
    const a = await insertDynimo("Aya", bornAt);
    await insertDynimo("Bo", null);
    const embedder = () =>
      new MockEmbeddingModelV4({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }) });
    const model = textModel("Hoi terug.");
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => bornAt, random: () => 0.99 });

    // A's beurt: pauzeren net na de mood-yield (vlak na adopt(), vóór de LLM-call en de finally-block).
    const it_ = brain.hear("Appelflap")[Symbol.asyncIterator]();
    const first = await it_.next();
    expect(first.done).toBe(false);

    // Wissel: A slaapt, B wordt de wakkere Dynimo. recognizeFaces([]) adopteert B (net als considerInitiative).
    await db.update(dynimos).set({ awakeSince: null }).where(eq(dynimos.id, a.id));
    await db.update(dynimos).set({ awakeSince: new Date(bornAt.getTime() + 1000) }).where(eq(dynimos.name, "Bo"));
    await brain.recognizeFaces([]);

    // A's beurt afmaken: schrijft (in de finally-block) naar zijn eigen, bij de start vastgelegde sessie.
    let next = await it_.next();
    while (!next.done) next = await it_.next();
    await brain.settled();

    // B's eerste beurt: zijn Werkgeheugen hoort leeg te beginnen.
    await drain(brain.hear("Hoi"));

    const promptOf = (call: number) => JSON.stringify(model.doStreamCalls[call]?.prompt);
    expect(promptOf(0)).toContain("Appelflap"); // sanity: A's eigen beurt bevatte het wél
    expect(promptOf(1)).not.toContain("Appelflap"); // B's beurt draagt A's Werkgeheugen niet mee
  });

  it("een achtergrond-remember van A die klaar is ná de wissel komt niet in B's unknownSessionMemoryIds terecht", async () => {
    const a = await insertDynimo("Aya", bornAt);
    await insertDynimo("Bo", null);

    // Eerste doEmbed-call is die van recall() (aan het begin van A's beurt); de tweede is die van A's
    // eind-Herinnering (op de achtergrond) en hangt tot de test hem vrijgeeft.
    let embedCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedEmbedder = new MockEmbeddingModelV4({
      doEmbed: async ({ values }) => {
        embedCalls++;
        if (embedCalls > 1) await gate;
        return { embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] };
      },
    });
    // Eén model voor de hele test: eerst A's gewone antwoord, dan B's leerKennen-aanroep gevolgd door zijn tekst.
    const textChunk = (text: string) => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "1" },
          { type: "text-delta" as const, id: "1", delta: text },
          { type: "text-end" as const, id: "1" },
          { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
        ],
      }),
    });
    const model = new MockLanguageModelV4({
      doStream: [
        textChunk("Hoi!"), // A's beurt
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "tool-call" as const, toolCallId: "call-1", toolName: "leerKennen", input: JSON.stringify({ naam: "Bo" }) },
              { type: "finish" as const, usage: NULL_USAGE, finishReason: TOOL_CALLS },
            ],
          }),
        },
        textChunk("Hoi Bo!"), // B's beurt, na leerKennen
      ],
    });
    const brain = createBrain({ db, embedder: gatedEmbedder, type1: type1(), type2: { light: model, heavy: model }, now: () => bornAt, random: () => 0.99 });

    // A's beurt: de stream rondt af, maar de eind-Herinnering (achtergrond) hangt nog op de gate.
    await drain(brain.hear("Hoi", { gesprekspartner: { soort: "onbekend" } }));
    expect(await db.select().from(memories).where(eq(memories.dynimoId, a.id))).toHaveLength(0);

    // Wissel: A slaapt, B wordt wakker (nieuwe sessie), vóórdat A's achtergrondschrijfactie klaar is.
    await db.update(dynimos).set({ awakeSince: null }).where(eq(dynimos.id, a.id));
    await db.update(dynimos).set({ awakeSince: new Date(bornAt.getTime() + 1000) }).where(eq(dynimos.name, "Bo"));
    await brain.recognizeFaces([]);

    release();
    await brain.settled(); // A's eind-Herinnering wordt nu alsnog opgeslagen (personId null).

    const aMemories = await db.select().from(memories).where(eq(memories.dynimoId, a.id));
    expect(aMemories).toHaveLength(1);
    expect(aMemories[0]!.personId).toBeNull();

    // B's leerKennen: als A's Herinnering per ongeluk in B's unknownSessionMemoryIds beland is, koppelt dit hem
    // aan Bo — dat mag niet, ook al zijn het verschillende Dynimo's (leerKennenPersoon filtert niet op dynimoId).
    await drain(brain.hear("Ik heet Bo", { gesprekspartner: { soort: "onbekend" } }));
    await brain.settled();

    const boPerson = (await db.select().from(persons).where(eq(persons.name, "Bo")))[0]!;
    expect(boPerson).toBeTruthy();
    const stillA = await db.select().from(memories).where(eq(memories.dynimoId, a.id));
    expect(stillA[0]!.personId).toBeNull();
  });
});
