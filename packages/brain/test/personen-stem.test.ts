import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { dynimos, EMBEDDING_DIMENSIONS, memories, persons, voiceProfiles } from "@animus/db/schema";
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

// Model dat eerst een tool aanroept (bv. leerKennen), dan pas tekst geeft.
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

// Roept dezelfde tool tweemaal aan binnen één beurt (multi-step), dan pas tekst: simuleert een model dat
// leerKennen per ongeluk twee keer aanroept.
function toolTwiceThenTextModel(toolName: string, firstInput: object, secondInput: object, answer: string) {
  const step = (toolCallId: string, input: object) => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "tool-call" as const, toolCallId, toolName, input: JSON.stringify(input) },
        { type: "finish" as const, usage: NULL_USAGE, finishReason: TOOL_CALLS },
      ],
    }),
  });
  return new MockLanguageModelV4({
    doStream: [
      step("call-1", firstInput),
      step("call-2", secondInput),
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

const brainWith = (model: MockLanguageModelV4, random = () => 0.99) =>
  createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random });

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

describe("voiceProfiles / addVoiceProfile (#92)", () => {
  it("addVoiceProfile voegt toe; voiceProfiles geeft ze terug", async () => {
    const anna = await insertPerson("Anna");
    const brain = brainWith(textModel());
    await brain.addVoiceProfile(anna.id, new Uint8Array([1, 2, 3]));
    const profiles = await brain.voiceProfiles();
    expect(profiles).toEqual([{ personId: anna.id, profile: new Uint8Array([1, 2, 3]) }]);
  });

  it("houdt hoogstens 5 profielen per Persoon: de oudste gaat weg", async () => {
    const anna = await insertPerson("Anna");
    const brain = brainWith(textModel());
    for (let i = 0; i < 6; i++) await brain.addVoiceProfile(anna.id, new Uint8Array([i]));
    const rows = await db.select().from(voiceProfiles).where(eq(voiceProfiles.personId, anna.id));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.profile[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("profielen van verschillende Personen blijven gescheiden", async () => {
    const anna = await insertPerson("Anna");
    const bert = await insertPerson("Bert");
    const brain = brainWith(textModel());
    await brain.addVoiceProfile(anna.id, new Uint8Array([1]));
    await brain.addVoiceProfile(bert.id, new Uint8Array([2]));
    const profiles = await brain.voiceProfiles();
    expect(profiles).toHaveLength(2);
  });
});

describe("leerKennen (#92)", () => {
  it("wordt enkel aangeboden als de Gesprekspartner onbekend is", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    let sawLeerKennenBekend = false;
    let sawLeerKennenOnbekend = false;
    const bekendModel = new MockLanguageModelV4({
      doStream: async (options) => {
        if ("tools" in options && options.tools?.some((t) => t.name === "leerKennen")) sawLeerKennenBekend = true;
        return textModel().doStream(options);
      },
    });
    await drain(brainWith(bekendModel).hear("Hoi", { gesprekspartner: anna.id }));
    expect(sawLeerKennenBekend).toBe(false);

    const onbekendModel = new MockLanguageModelV4({
      doStream: async (options) => {
        if ("tools" in options && options.tools?.some((t) => t.name === "leerKennen")) sawLeerKennenOnbekend = true;
        return textModel().doStream(options);
      },
    });
    await drain(brainWith(onbekendModel).hear("Hoi", { gesprekspartner: null }));
    expect(sawLeerKennenOnbekend).toBe(true);
    void vero;
  });

  it("het tool-schema bevat geen regex-pattern (OpenAI weigert \\p{L})", async () => {
    await insertDynimo();
    let schema = "";
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        const leerKennen = options.tools?.find((t) => t.name === "leerKennen");
        if (leerKennen && "inputSchema" in leerKennen) schema = JSON.stringify(leerKennen.inputSchema);
        return textModel().doStream(options);
      },
    });
    await drain(brainWith(model).hear("Hoi", { gesprekspartner: null }));
    expect(schema).toContain("naam");
    expect(schema).not.toContain("pattern");
  });

  it("maakt de Persoon aan, koppelt de onbekende-Herinneringen van deze sessie en de eind-Herinnering, yieldt persoon-event", async () => {
    const vero = await insertDynimo();
    const model = toolThenTextModel("leerKennen", { naam: "Anna" }, "Leuk je te ontmoeten, Anna!");
    const brain = brainWith(model);

    await drain(brain.hear("Ik heet Anna", { gesprekspartner: null }));

    const persoon = (await db.select().from(persons).where(eq(persons.name, "Anna")))[0]!;
    expect(persoon).toBeTruthy();

    await brain.settled();
    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.personId).toBe(persoon.id);

    const events: unknown[] = [];
    const model2 = toolThenTextModel("leerKennen", { naam: "Bert" }, "Hoi Bert!");
    const brain2 = brainWith(model2);
    for await (const event of brain2.hear("Ik heet Bert", { gesprekspartner: null })) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: "persoon", naam: "Bert" }));
  });

  it("#109: de stream is al klaar vóórdat de eind-Herinnering (na leerKennen) is opgeslagen; settled() wacht hem af, met de juiste person_id", async () => {
    const vero = await insertDynimo();
    // Eerste doEmbed-call is die van recall() (aan het begin van de beurt, hoort meteen te resolven); de tweede is
    // die van de eind-Herinnering in remember() (op de achtergrond) en hangt tot de test hem vrijgeeft.
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
    const model = toolThenTextModel("leerKennen", { naam: "Anna" }, "Leuk je te ontmoeten, Anna!");
    const brain = createBrain({ db, embedder: gatedEmbedder, type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99 });

    await drain(brain.hear("Ik heet Anna", { gesprekspartner: null }));

    // De stream is afgelopen; de eind-Herinnering ligt er nog niet (de embed hangt op de gate).
    expect(await db.select().from(memories).where(eq(memories.dynimoId, vero.id))).toHaveLength(0);

    release();
    await brain.settled();

    const anna = (await db.select().from(persons).where(eq(persons.name, "Anna")))[0]!;
    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.personId).toBe(anna.id);
  });

  it("#109: leerKennen wacht een nog-lopende eind-Herinnering van een vorige beurt af (geen race met een latere bezoeker)", async () => {
    await insertDynimo();
    // Beurt 1 (onbekende Gesprekspartner, geen tool): zijn eind-Herinnering (embed van de opgeslagen Herinnering-
    // tekst, te herkennen aan het "Gesprekspartner:"-voorvoegsel) hangt op de gate; recall()'s embed (de kale
    // uiting, geen voorvoegsel) resolvet altijd meteen. Beurt 2 (óók onbekend) roept meteen leerKennen aan: die
    // mag pas de unknownSessionMemoryIds snapshotten nadat beurt 1's opslag echt klaar is. De gate wordt pas
    // vrijgegeven ná het tool-call-event van beurt 2 (dan is leerKennenPersoon() al aangeroepen), zodat de test
    // niet toevallig slaagt door een gunstige microtask-volgorde.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedEmbedder = new MockEmbeddingModelV4({
      doEmbed: async ({ values }) => {
        if (values.some((value) => value.startsWith("Gesprekspartner:"))) await gate;
        return { embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] };
      },
    });
    const model = new MockLanguageModelV4({
      doStream: [
        {
          // beurt 1: gewoon antwoord, geen tool
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "text-start" as const, id: "1" },
              { type: "text-delta" as const, id: "1", delta: "Oké, genoteerd." },
              { type: "text-end" as const, id: "1" },
              { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
            ],
          }),
        },
        {
          // beurt 2, stap 1: leerKennen
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "tool-call" as const, toolCallId: "call-1", toolName: "leerKennen", input: JSON.stringify({ naam: "Anna" }) },
              { type: "finish" as const, usage: NULL_USAGE, finishReason: TOOL_CALLS },
            ],
          }),
        },
        {
          // beurt 2, stap 2: antwoord ná het tool-resultaat
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "text-start" as const, id: "1" },
              { type: "text-delta" as const, id: "1", delta: "Leuk je te ontmoeten, Anna!" },
              { type: "text-end" as const, id: "1" },
              { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
            ],
          }),
        },
      ],
    });
    const brain = createBrain({ db, embedder: gatedEmbedder, type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99 });

    await drain(brain.hear("Ik ben een vreemdeling.", { gesprekspartner: null }));
    // Beurt 1 is afgelopen; zijn eind-Herinnering ligt er nog niet (de embed hangt op de gate).
    expect(await db.select().from(memories)).toHaveLength(0);

    const turn2Events = brain.hear("Ik heet Anna", { gesprekspartner: null });
    const iterator = turn2Events[Symbol.asyncIterator]();
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) throw new Error("beurt 2 eindigde vóór het tool-call-event");
      if (value.type === "tool-call") break;
    }
    release();
    for (;;) {
      const { done } = await iterator.next();
      if (done) break;
    }
    await brain.settled();

    const anna = (await db.select().from(persons).where(eq(persons.name, "Anna")))[0]!;
    const rows = await db.select().from(memories);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.personId).toBe(anna.id);
  });

  it("koppelt enkel de onbekende-Herinneringen van déze sessie, niet die van de eigenaar", async () => {
    const vero = await insertDynimo();
    const brain = brainWith(textModel());
    // Een eerdere, gewone beurt van de eigenaar: mag niet meeverhuizen.
    await drain(brain.hear("Hoi eigenaar"));

    const model = toolThenTextModel("leerKennen", { naam: "Anna" }, "Hoi Anna!");
    const brain2 = brainWith(model);
    await drain(brain2.hear("Ik ben Anna", { gesprekspartner: null }));

    const owner = (await db.select().from(persons).where(eq(persons.owner, true)))[0]!;
    await Promise.all([brain.settled(), brain2.settled()]);
    const ownerMemories = await db.select().from(memories).where(eq(memories.personId, owner.id));
    expect(ownerMemories).toHaveLength(1); // enkel de eigenaar-beurt van vóór leerKennen, niet verhuisd
    void vero;
  });

  it("ongeldige naam: tool-fout, geen Persoon aangemaakt", async () => {
    const model = toolThenTextModel("leerKennen", { naam: "" }, "Oh.");
    const brain = brainWith(model);
    await drain(brain.hear("Ik heet ", { gesprekspartner: null }));
    expect(await db.select().from(persons)).toHaveLength(0);
  });

  it("naam met cijfers of symbolen: tool-fout, geen Persoon aangemaakt", async () => {
    await insertDynimo();
    const model = toolThenTextModel("leerKennen", { naam: "Anna123" }, "Oh.");
    const brain = brainWith(model);
    await drain(brain.hear("Ik heet Anna123", { gesprekspartner: null }));
    expect(await db.select().from(persons)).toHaveLength(0);
  });

  it("naam met accenten, koppelteken en apostrof is geldig", async () => {
    await insertDynimo();
    const model = toolThenTextModel("leerKennen", { naam: "Anne-José O'Brien" }, "Hoi!");
    const brain = brainWith(model);
    await drain(brain.hear("Ik heet Anne-José O'Brien", { gesprekspartner: null }));
    expect(await db.select().from(persons)).toHaveLength(1);
  });

  it("een tweede leerKennen-aanroep binnen dezelfde beurt maakt geen tweede Persoon", async () => {
    await insertDynimo();
    const model = toolTwiceThenTextModel("leerKennen", { naam: "Anna" }, { naam: "Bert" }, "Hoi!");
    const brain = brainWith(model);

    const events: unknown[] = [];
    for await (const event of brain.hear("Ik heet Anna", { gesprekspartner: null })) events.push(event);

    expect(await db.select().from(persons)).toHaveLength(1);
    const persoonEvents = events.filter((event) => (event as { type: string }).type === "persoon");
    expect(persoonEvents).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ toolName: "leerKennen", output: { algekend: true } }));
  });

  it("een latere, andere onbekende in dezelfde sessie koppelt enkel de Herinneringen van ná de vorige kennismaking", async () => {
    await insertDynimo();
    // Eén model, drie opeenvolgende beurten in dezelfde brain-sessie: leerKennen(Anna), een gewone (nog steeds
    // onbekende) tussenbeurt, dan leerKennen(Bert). unknownSessionMemoryIds hoort na Anna geleegd te zijn, zodat
    // Bert niet ook Anna's al-gekoppelde Herinnering krijgt.
    const step = (toolCall?: { toolName: string; input: object }, text = "Hoi!") =>
      toolCall
        ? {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start" as const, warnings: [] },
                { type: "tool-call" as const, toolCallId: `call-${toolCall.toolName}-${text}`, toolName: toolCall.toolName, input: JSON.stringify(toolCall.input) },
                { type: "finish" as const, usage: NULL_USAGE, finishReason: TOOL_CALLS },
              ],
            }),
          }
        : {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start" as const, warnings: [] },
                { type: "text-start" as const, id: "1" },
                { type: "text-delta" as const, id: "1", delta: text },
                { type: "text-end" as const, id: "1" },
                { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
              ],
            }),
          };
    const model = new MockLanguageModelV4({
      doStream: [
        step({ toolName: "leerKennen", input: { naam: "Anna" } }),
        step(undefined, "Hoi Anna!"),
        step(undefined, "Oké"),
        step({ toolName: "leerKennen", input: { naam: "Bert" } }),
        step(undefined, "Hoi Bert!"),
      ],
    });
    const brain = brainWith(model);

    await drain(brain.hear("Ik heet Anna", { gesprekspartner: null }));
    const anna = (await db.select().from(persons).where(eq(persons.name, "Anna")))[0]!;
    await drain(brain.hear("Nog een vraag", { gesprekspartner: null }));
    await drain(brain.hear("Ik heet Bert", { gesprekspartner: null }));
    const bert = (await db.select().from(persons).where(eq(persons.name, "Bert")))[0]!;

    await brain.settled();
    const annaMemories = await db.select().from(memories).where(eq(memories.personId, anna.id));
    const bertMemories = await db.select().from(memories).where(eq(memories.personId, bert.id));
    expect(annaMemories.length).toBeGreaterThan(0);
    expect(bertMemories.length).toBeGreaterThan(0);
    for (const memory of bertMemories) expect(memory.personId).not.toBe(anna.id);
  });
});

describe("naamvraag (#92)", () => {
  it("vraagt de naam enkel de eerste onbekende beurt van de sessie", async () => {
    await insertDynimo();
    const brain = brainWith(textModel());
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    const brain2 = brainWith(model);
    await drain(brain2.hear("Hoi", { gesprekspartner: null }));
    await drain(brain2.hear("Hoi nogmaals", { gesprekspartner: null }));

    expect(prompts[0]).toContain("Vraag vriendelijk hoe die heet");
    expect(prompts[1]).not.toContain("Vraag vriendelijk hoe die heet");
    void brain;
  });
});

describe("considerInitiative onbekend (#92)", () => {
  it("Type1-state krijgt de aanleiding, geeft naamvraag-instructie de eerste keer, null de tweede", async () => {
    const vero = await insertDynimo();
    let sawAanleiding = false;
    const t1 = new Experimental_EvaluationMockModelV4({
      doEvaluate: async (options) => {
        const state = (options as { state: string }).state;
        if (state.includes("er is iemand die je nog niet kent")) sawAanleiding = true;
        const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
        const known: Record<string, { type: "choice"; choice: string }> = { spreken: { type: "choice", choice: "ja" }, onderwerp: { type: "choice", choice: "vrij" } };
        return { answers: Object.fromEntries(questions.map((key) => [key, known[key]!])), warnings: [] };
      },
    });
    const brain = createBrain({ db, embedder: embedder(), type1: t1, type2: { light: textModel(), heavy: textModel() }, now: () => now, random: () => 0.99 });

    const instruction = await brain.considerInitiative({ soort: "onbekend" });
    expect(sawAanleiding).toBe(true);
    expect(instruction).toContain("naam");

    const second = await brain.considerInitiative({ soort: "onbekend" });
    expect(second).toBeNull();
    void vero;
  });
});

describe("naamregels in de Type2-prompt (#92)", () => {
  it("bekende Persoon: 'Je praat nu met <naam>.'", async () => {
    await insertDynimo();
    const anna = await insertPerson("Anna");
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    await drain(brainWith(model).hear("Hoi", { gesprekspartner: anna.id }));
    expect(prompts[0]).toContain("Je praat nu met Anna.");
  });

  it("eigenaar: 'Je praat nu met je eigenaar.' (niet de letterlijke naam)", async () => {
    await insertDynimo();
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    await drain(brainWith(model).hear("Hoi"));
    expect(prompts[0]).toContain("Je praat nu met je eigenaar.");
    expect(prompts[0]).not.toContain("eigenaar\\u0027s naam");
  });

  it("onbekend: 'Je weet niet wie er nu praat.'", async () => {
    await insertDynimo();
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return textModel().doStream(options);
      },
    });
    await drain(brainWith(model).hear("Hoi", { gesprekspartner: null }));
    expect(prompts[0]).toContain("Je weet niet wie er nu praat.");
  });
});
