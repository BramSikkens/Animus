import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { eq, isNotNull } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, drives, dynimos, epitaphs, memories } from "@animus/db/schema";
import postgres from "postgres";
import { createBrain, STATE_CHANNEL, type BrainEvent } from "../src/index.js";
import { createTestDb, databaseUrl, TEST_DB_NAME, truncateAll } from "./db.js";

const db = createTestDb();

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

const MID_AXES = { ie: 0.5, sn: 0.5, tf: 0.5, jp: 0.5 };

const MID_DRIVES = {
  wens: [{ text: "Een zachte wens" }],
  doel: [{ text: "Een concreet streven" }],
  toekomstdroom: [{ text: "Een verre droom" }],
  afkeer: [{ text: "Een diepe weerzin", strength: 0.6 }],
  ergernis: [{ text: "Een kleine ergernis", strength: 0.3 }],
};

function genesisModel(result: {
  name: string;
  coreCharacter: string;
  birthStory: string;
  axes?: { ie: number; sn: number; tf: number; jp: number };
  drives?: typeof MID_DRIVES;
  baseEmotion?: string;
}) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify({ axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm", ...result }) }],
      finishReason: STOP,
      usage: NULL_USAGE,
      warnings: [],
    }),
  });
}

function generateResult(text: string) {
  return { content: [{ type: "text" as const, text }], finishReason: STOP, usage: NULL_USAGE, warnings: [] };
}

// Zwaar model voor een volledige levensloop: eerst de genesis, daarna de Afscheidsreflectie.
function lifecycleModel(name: string, farewell: string) {
  return new MockLanguageModelV4({
    doGenerate: [
      generateResult(JSON.stringify({ name, coreCharacter: "Speels.", birthStory: "Geboren uit ochtendnevel.", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
      generateResult(farewell),
    ],
  });
}

function unusedModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("Type2-model had niet aangeroepen mogen worden");
    },
    doStream: async () => {
      throw new Error("Type2-model had niet aangeroepen mogen worden");
    },
  });
}

function textModel(chunks: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "1" },
          ...chunks.map((delta) => ({ type: "text-delta" as const, id: "1", delta })),
          { type: "text-end" as const, id: "1" },
          { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
        ],
      }),
    }),
  });
}

// Deterministische fake-embedding: elk trefwoord krijgt zijn eigen as; tekst zonder trefwoord valt op de laatste as.
const KEYWORDS = ["kat", "pizza"];
function fakeVector(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const axis = KEYWORDS.findIndex((keyword) => text.toLowerCase().includes(keyword));
  vector[axis === -1 ? EMBEDDING_DIMENSIONS - 1 : axis] = 1;
  return vector;
}

function embedModel() {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(fakeVector), warnings: [] }),
  });
}

// Default: neutraal/0.5/simpel. Registreert calls zelf (de mock houdt ze niet bij), t.b.v. test 5.
function type1Model(
  overrides: Partial<{ emotion: string; intensity: number; intent: "simpel" | "complex" }> = {},
): Experimental_EvaluationMockModelV4 & { doEvaluateCalls: unknown[] } {
  const { emotion = "neutraal", intensity = 0.5, intent = "simpel" } = overrides;
  const doEvaluateCalls: unknown[] = [];
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      doEvaluateCalls.push(options);
      return {
        answers: {
          emotion: { type: "choice", choice: emotion },
          intensity: { type: "score", score: intensity },
          intent: { type: "choice", choice: intent },
        },
        warnings: [],
      };
    },
  });
  return Object.assign(model, { doEvaluateCalls });
}

const TOOL_CALLS: { unified: "tool-calls"; raw: undefined } = { unified: "tool-calls", raw: undefined };

function toolCallStream(toolName: string, input: object) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "tool-call" as const, toolCallId: "call-1", toolName, input: JSON.stringify(input) },
        { type: "finish" as const, usage: NULL_USAGE, finishReason: TOOL_CALLS },
      ],
    }),
  };
}

function textStream(text: string) {
  return {
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
}

// Eerste stream: Type2 roept een tool aan; tweede stream: het antwoord na het tool-resultaat.
function toolThenTextModel(toolName: string, input: object, answer: string) {
  return new MockLanguageModelV4({ doStream: [toolCallStream(toolName, input), textStream(answer)] });
}

function contentsByRole(prompt: unknown, role: "system" | "user"): string[] {
  return (prompt as Array<{ role: string; content: unknown }>)
    .filter((message) => message.role === role)
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
}

async function collectText(events: AsyncIterable<BrainEvent>): Promise<string> {
  let full = "";
  for await (const event of events) {
    if (event.type === "text") full += event.delta;
  }
  return full;
}

describe("createBrain", () => {
  it("draait genesis bij bringToLife() en laat de nieuwe Dynimo meteen wakker zijn", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const heavy = genesisModel({
      name: "Nova",
      coreCharacter: "Nieuwsgierig en zachtaardig.",
      birthStory: "Nova ontwaakte uit een ochtendnevel over stil water.",
    });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy },
      now: () => bornAt,
      random: () => 0,
    });

    const result = await brain.bringToLife();

    expect(result.name).toBe("Nova");
    expect(result.coreCharacter).toBe("Nieuwsgierig en zachtaardig.");
    expect(result.birthStory).toBe("Nova ontwaakte uit een ochtendnevel over stil water.");
    expect(result.evolvedCharacter).toBe("");
    expect(result.bornAt).toEqual(bornAt);
    expect(result.seed).toBe("ochtendnevel over een stil water"); // random 0 → eerste Seed uit seeds.ts
    expect(JSON.stringify(heavy.doGenerateCalls[0]?.prompt)).toContain(result.seed);

    const rows = await db.select().from(dynimos);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Nova");
    expect(rows[0]?.seed).toBe(result.seed);
    expect(result.awakeSince).toEqual(bornAt);
    expect(rows[0]?.awakeSince).toEqual(bornAt);
  });

  it("praat vanuit een nieuwe brain-instantie met de wakkere Dynimo, zonder genesis", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const firstBrain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: genesisModel({ name: "Nova", coreCharacter: "Nieuwsgierig.", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await firstBrain.bringToLife();

    const light = textModel(["Hoi."]);
    const heavy = unusedModel();
    const secondBrain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy },
      now: () => bornAt,
      random: () => 0,
    });
    await collectText(secondBrain.hear("Hallo!"));

    expect(contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ")).toContain("Nova");
    expect(heavy.doGenerateCalls).toHaveLength(0);
    expect(await db.select().from(dynimos)).toHaveLength(1);
  });

  it("berekent de Leeftijd als kalendertijd sinds born_at en stuurt die mee naar Type2", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    let clock = bornAt;
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => clock,
      random: () => 0,
    });
    await brain.bringToLife();

    clock = new Date(bornAt.getTime() + 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000);
    const light = textModel(["Hoi."]);
    const brainWithLight = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: unusedModel() },
      now: () => clock,
      random: () => 0,
    });
    await collectText(brainWithLight.hear("Hallo!"));

    const contents = contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ");
    expect(contents).toContain("3 dagen");
  });

  it("levert de gestreamde tekst van hear() als text-events, met naam en karakter in het system-deel", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Hallo", " daar!"]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "Speels en oplettend.", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    const text = await collectText(brain.hear("Hoi Nova!"));

    expect(text).toBe("Hallo daar!");
    const contents = contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ");
    expect(contents).toContain("Nova");
    expect(contents).toContain("Speels en oplettend.");
  });

  it("stuurt bij een tweede hear() de vorige beurt mee als werkgeheugen", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Leuk je te ontmoeten.", "Je heet Bram."]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Ik heet Bram."));
    await collectText(brain.hear("Wat is mijn naam?"));

    expect(light.doStreamCalls).toHaveLength(2);
    const userTexts = contentsByRole(light.doStreamCalls[1]?.prompt, "user");
    expect(userTexts.some((c) => c.includes("Ik heet Bram."))).toBe(true);
    expect(userTexts.some((c) => c.includes("Wat is mijn naam?"))).toBe(true);
  });

  it("neemt een mislukte beurt niet op in het werkgeheugen", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    let calls = 0;
    const light = new MockLanguageModelV4({
      doStream: async () => {
        calls++;
        if (calls === 1) throw new Error("provider plat");
        return textModel(["Hoi."]).doStream({} as never);
      },
    });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await expect(collectText(brain.hear("Mislukt"))).rejects.toThrow();
    await collectText(brain.hear("Tweede poging"));

    const userTexts = contentsByRole(light.doStreamCalls[1]?.prompt, "user");
    expect(userTexts.some((c) => c.includes("Mislukt"))).toBe(false);
  });

  it("levert een mood-event met de effectieve Stemming (Type1-Emotie won van de Basisemotie), vóór de eerste tekst", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Hoi."]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model({ emotion: "blij", intensity: 0.8 }),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    const events: BrainEvent[] = [];
    for await (const event of brain.hear("Hoi!")) events.push(event);

    expect(events[0]).toEqual({ type: "mood", emotion: "blij", intensity: 0.8 });
    const emotionIndex = events.findIndex((e) => e.type === "mood");
    const firstTextIndex = events.findIndex((e) => e.type === "text");
    expect(emotionIndex).toBeLessThan(firstTextIndex);
  });

  it("routeert intent 'complex' naar het zware Type2-model, zonder het lichte aan te roepen", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const genesisBrain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await genesisBrain.bringToLife();

    const heavy = textModel(["Zwaar antwoord."]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model({ intent: "complex" }),
      type2: { light: unusedModel(), heavy },
      now: () => bornAt,
      random: () => 0,
    });
    const text = await collectText(brain.hear("Leg iets ingewikkelds uit."));

    expect(text).toBe("Zwaar antwoord.");
    expect(heavy.doStreamCalls).toHaveLength(1);
  });

  it("routeert intent 'simpel' naar het lichte Type2-model, zonder het zware aan te roepen", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const genesisBrain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await genesisBrain.bringToLife();

    const light = textModel(["Hoi!"]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model({ intent: "simpel" }),
      type2: { light, heavy: unusedModel() },
      now: () => bornAt,
      random: () => 0,
    });
    const text = await collectText(brain.hear("Hoi!"));

    expect(text).toBe("Hoi!");
    expect(light.doStreamCalls).toHaveLength(1);
  });

  it("bewaart de nieuwe Stemming (emotie, intensiteit, tijdstip) in de mood-kolommen", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Hoi."]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model({ emotion: "nieuwsgierig", intensity: 0.65 }),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Vertel eens iets nieuws."));

    const rows = await db.select().from(dynimos);
    expect(rows[0]?.moodEmotion).toBe("nieuwsgierig");
    expect(rows[0]?.moodIntensity).toBeCloseTo(0.65);
    expect(rows[0]?.moodAt).toEqual(bornAt);
  });

  it("geeft de uiting als onderdeel van de state aan Type1 mee", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Hoi."]);
    const type1 = type1Model();
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1,
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Wat een mooie dag!"));

    expect(type1.doEvaluateCalls).toHaveLength(1);
    expect(String((type1.doEvaluateCalls[0] as { state: unknown }).state)).toContain("Wat een mooie dag!");
  });

  it("antwoordt toch via het lichte model op de Basisemotie-Stemming als Type1 faalt, zonder de Stemming te wijzigen", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Hoi."]);
    const heavy = genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" });
    const brokenType1 = new Experimental_EvaluationMockModelV4({
      doEvaluate: async () => {
        throw new Error("Jev plat");
      },
    });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: brokenType1,
      type2: { light, heavy },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    const events: BrainEvent[] = [];
    for await (const event of brain.hear("Hoi!")) events.push(event);

    expect(events[0]).toEqual({ type: "mood", emotion: "kalm", intensity: 0.3 });
    expect((await db.select().from(dynimos))[0]?.moodAt).toBeNull();
    expect(light.doStreamCalls).toHaveLength(1); // intent simpel: het lichte model antwoordde
    expect(heavy.doStreamCalls).toHaveLength(0);
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Hoi.");
  });

  it("bewaart na een beurt een geheugen met tekst, embedding en tijdstip", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Wat een mooie naam!"]), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Mijn kat heet Mimi."));

    const rows = await db.select().from(memories);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toContain("Mijn kat heet Mimi.");
    expect(rows[0]?.text).toContain("Wat een mooie naam!");
    expect(rows[0]?.embedding).toEqual(fakeVector("kat"));
    expect(rows[0]?.createdAt).toEqual(bornAt);
  });

  it("geeft na een herstart het meest relevante geheugen uit een vorige sessie eerst mee aan Type2", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const firstSession = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Genoteerd."]), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await firstSession.bringToLife();
    await collectText(firstSession.hear("Ik hou van pizza."));
    await collectText(firstSession.hear("Mijn kat heet Mimi."));

    const light = textModel(["Mimi!"]);
    const secondSession = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: unusedModel() },
      now: () => bornAt,
      random: () => 0,
    });
    await collectText(secondSession.hear("Hoe heet mijn kat?"));

    const system = contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ");
    expect(system).toContain("Mijn kat heet Mimi.");
    expect(system.indexOf("Mijn kat heet Mimi.")).toBeLessThan(system.indexOf("Ik hou van pizza."));
  });

  it("antwoordt toch als het embedden faalt, zonder herinneringen en zonder fout", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const brokenEmbed = new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw new Error("embeddings plat");
      },
    });
    const brain = createBrain({
      db,
      embedder: brokenEmbed,
      type1: type1Model(),
      type2: { light: textModel(["Hoi."]), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    expect(await collectText(brain.hear("Hoi!"))).toBe("Hoi.");
  });

  it("geeft beurten uit de huidige sessie niet nog eens als herinnering mee", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Genoteerd."]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Mijn kat heet Mimi."));
    await collectText(brain.hear("Hoe heet mijn kat?"));

    const system = contentsByRole(light.doStreamCalls[1]?.prompt, "system").join(" ");
    expect(system).not.toContain("Mijn kat heet Mimi.");
  });

  it("laat Type2 de datum/tijd-tool aanroepen en geeft het resultaat terug aan Type2", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const light = toolThenTextModel("current_datetime", {}, "Het is donderdag.");
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    const events: BrainEvent[] = [];
    for await (const event of brain.hear("Welke dag is het vandaag?")) events.push(event);

    expect(events).toContainEqual(expect.objectContaining({ type: "tool-call", toolName: "current_datetime" }));
    const result = events.find((e) => e.type === "tool-result");
    expect(JSON.stringify(result)).toContain("1 januari 2026");
    expect(JSON.stringify(light.doStreamCalls[1]?.prompt)).toContain("1 januari 2026");
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Het is donderdag.");
  });

  it("laat Type2 de onthoud-tool aanroepen, die een herinnering met embedding wegschrijft", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const light = toolThenTextModel("remember", { text: "Bram drinkt zijn koffie zwart." }, "Onthouden!");
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Onthoud dat ik mijn koffie zwart drink."));

    const rows = await db.select().from(memories);
    const remembered = rows.find((row) => row.text === "Bram drinkt zijn koffie zwart.");
    expect(remembered?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(remembered?.createdAt).toEqual(bornAt);
  });

  it("houdt de tool-stappen van een beurt in het werkgeheugen voor de volgende beurt", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const light = new MockLanguageModelV4({
      doStream: [toolCallStream("current_datetime", {}), textStream("Het is donderdag."), textStream("Vrijdag.")],
    });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Welke dag is het?"));
    await collectText(brain.hear("En morgen?"));

    const secondTurn = light.doStreamCalls[2]?.prompt as Array<{ role: string }>;
    expect(secondTurn.some((message) => message.role === "tool")).toBe(true);
  });

  it("levert ook een tool-result-gebeurtenis met de fout als een tool faalt", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const light = toolThenTextModel("remember", { text: "" }, "Oei, dat lukte niet.");
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    const events: BrainEvent[] = [];
    for await (const event of brain.hear("Onthoud dit.")) events.push(event);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool-result", toolName: "remember", output: { error: expect.any(String) } }),
    );
  });

  it("slaat een beurt zonder antwoordtekst niet op als herinnering", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const light = new MockLanguageModelV4({ doStream: [toolCallStream("current_datetime", {}), textStream("")] });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();
    await collectText(brain.hear("Welke dag is het?"));

    expect(await db.select().from(memories)).toHaveLength(0);
  });

  it("doet niets bij kill() zonder de juiste naam als bevestiging", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const heavy = genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Hoi."]), heavy },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await brain.bringToLife();
    await collectText(brain.hear("Mijn kat heet Mimi."));

    expect(await brain.kill(nova.id, "Nora")).toBeNull();
    expect(await brain.kill(nova.id + 999, "Nova")).toBeNull();

    expect(await db.select().from(dynimos)).toHaveLength(1);
    expect(await db.select().from(memories)).toHaveLength(1);
    expect(heavy.doGenerateCalls).toHaveLength(1); // enkel de genesis
  });

  it("schrijft bij kill() met de juiste naam een Grafschrift en wist de Dynimo en zijn herinneringen", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const deletedAt = new Date("2026-01-11T12:00:00.000Z");
    let clock = bornAt;
    const heavy = lifecycleModel("Nova", "Dank je voor elk gesprek.");
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Hoi."]), heavy },
      now: () => clock,
      random: () => 0,
    });
    const nova = await brain.bringToLife();
    await collectText(brain.hear("Mijn kat heet Mimi."));
    clock = deletedAt;

    const returned = await brain.kill(nova.id, "Nova");

    const [epitaph, ...rest] = await db.select().from(epitaphs);
    expect(rest).toHaveLength(0);
    expect(returned).toEqual(epitaph);
    expect(epitaph).toMatchObject({ name: "Nova", bornAt, deletedAt, farewellReflection: "Dank je voor elk gesprek." });
    expect(heavy.doGenerateCalls).toHaveLength(2); // genesis + aparte Afscheidsreflectie
    expect(JSON.stringify(heavy.doGenerateCalls[1]?.prompt)).toContain("Nova");
    expect(await db.select().from(dynimos)).toHaveLength(0);
    expect(await db.select().from(memories)).toHaveLength(0);
  });

  it("wist bij kill() enkel de Dynimo en herinneringen van het gedoode wezen, niet die van andere Dynimo's", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const heavy = lifecycleModel("Nova", "Dank je voor elk gesprek.");
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Hoi."]), heavy },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await brain.bringToLife();
    await collectText(brain.hear("Mijn kat heet Mimi."));

    const [other] = await db
      .insert(dynimos)
      .values({ name: "Vero", coreCharacter: "x", birthStory: "y", seed: "z", bornAt })
      .returning({ id: dynimos.id });
    await db
      .insert(memories)
      .values({ dynimoId: other!.id, text: "Herinnering van Vero.", embedding: fakeVector(""), createdAt: bornAt });

    await brain.kill(nova.id, "Nova");

    expect((await db.select().from(dynimos)).map((row) => row.name)).toEqual(["Vero"]);
    const otherMemories = await db.select().from(memories).where(eq(memories.dynimoId, other!.id));
    expect(otherMemories).toHaveLength(1);
    expect(otherMemories[0]?.text).toBe("Herinnering van Vero.");
  });

  it("laat na kill() van de wakkere Dynimo niemand wakker, en een nieuwe Dynimo ziet niets van het Grafschrift", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const heavy = new MockLanguageModelV4({
      doGenerate: [
        generateResult(JSON.stringify({ name: "Nova", coreCharacter: "Speels.", birthStory: "Ochtendnevel.", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
        generateResult("Vaarwel, lieve Mimi-kenner."),
        generateResult(JSON.stringify({ name: "Lumen", coreCharacter: "Rustig.", birthStory: "Maanlicht.", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
      ],
    });
    const light = new MockLanguageModelV4({ doStream: [textStream("Hoi."), textStream("Hallo, ik ben Lumen.")] });
    const type1 = type1Model();
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1,
      type2: { light, heavy },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await brain.bringToLife();
    await collectText(brain.hear("Mijn kat heet Mimi."));
    await brain.kill(nova.id, "Nova");

    expect(await db.select().from(dynimos).where(isNotNull(dynimos.awakeSince))).toHaveLength(0);
    expect(await collectText(brain.hear("Ben je er nog?"))).toBe("");
    expect(type1.doEvaluateCalls).toHaveLength(1); // enkel de eerste beurt

    const reborn = await brain.bringToLife();
    await collectText(brain.hear("Wie ben jij?"));

    expect(reborn.name).toBe("Lumen");
    expect(heavy.doGenerateCalls).toHaveLength(3); // genesis, afscheid, nieuwe genesis
    const inputsAfterDeletion = JSON.stringify([heavy.doGenerateCalls[2]?.prompt, light.doStreamCalls[1]?.prompt]);
    expect(inputsAfterDeletion).not.toContain("Nova");
    expect(inputsAfterDeletion).not.toContain("Vaarwel");
    expect(inputsAfterDeletion).not.toContain("Mimi");
  });

  it("maakt maar één Grafschrift als twee instanties hetzelfde wezen gelijktijdig doden", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const first = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: lifecycleModel("Nova", "Vaarwel.") },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await first.bringToLife();
    const second = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: new MockLanguageModelV4({ doGenerate: [generateResult("Ook vaarwel.")] }) },
      now: () => bornAt,
      random: () => 0,
    });

    const results = await Promise.all([first.kill(nova.id, "Nova"), second.kill(nova.id, "Nova")]);

    expect(results.filter((epitaph) => epitaph !== null)).toHaveLength(1);
    expect(await db.select().from(epitaphs)).toHaveLength(1);
  });

  it("kan een slapende Dynimo doden vanuit een andere instantie", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const maker = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await maker.bringToLife();
    await maker.sleep();
    const killer = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: new MockLanguageModelV4({ doGenerate: [generateResult("Vaarwel.")] }) },
      now: () => bornAt,
      random: () => 0,
    });

    expect(await killer.kill(nova.id, "Nova")).toMatchObject({ name: "Nova", farewellReflection: "Vaarwel." });
    expect(await db.select().from(dynimos)).toHaveLength(0);
  });

  it("levert geen events en gooit niet als de wakkere Dynimo door een andere instantie gedood is", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const deleter = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: lifecycleModel("Nova", "Vaarwel.") },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await deleter.bringToLife();
    const stale = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Hoi."]), heavy: unusedModel() },
      now: () => bornAt,
      random: () => 0,
    });
    await collectText(stale.hear("Hallo.")); // stale kent Nova nu
    await deleter.kill(nova.id, "Nova");

    const events: BrainEvent[] = [];
    for await (const event of stale.hear("Mijn kat heet Mimi.")) events.push(event);

    expect(events).toEqual([]);
    expect(await db.select().from(memories)).toHaveLength(0);
  });

  it("vergeet in een verouderde instantie ook het werkgeheugen, zodat een nieuwe Dynimo er niets van ziet", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const heavy = new MockLanguageModelV4({
      doGenerate: [
        generateResult(JSON.stringify({ name: "Nova", coreCharacter: "x", birthStory: "y", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
        generateResult("Vaarwel."),
        generateResult(JSON.stringify({ name: "Lumen", coreCharacter: "Rustig.", birthStory: "Maanlicht.", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
      ],
    });
    const deleter = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy },
      now: () => bornAt,
      random: () => 0,
    });
    const nova = await deleter.bringToLife();
    const light = new MockLanguageModelV4({ doStream: [textStream("Leuke kat."), textStream("Hoi, ik ben Lumen.")] });
    const stale = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: unusedModel() },
      now: () => bornAt,
      random: () => 0,
    });
    await collectText(stale.hear("Mijn kat heet Mimi."));
    await deleter.kill(nova.id, "Nova");
    await deleter.bringToLife();

    await collectText(stale.hear("Wie ben jij?"));

    expect(JSON.stringify(light.doStreamCalls[1]?.prompt)).not.toContain("Mimi");
  });

  it("onthoudt een onderbroken beurt (barge-in) met het deel dat al gezegd was", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const light = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "text-start" as const, id: "1" },
              { type: "text-delta" as const, id: "1", delta: "Wat een mooie " },
              { type: "text-delta" as const, id: "1", delta: "naam voor een kat." },
              { type: "text-end" as const, id: "1" },
              { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
            ],
          }),
        },
        textStream("Mimi, natuurlijk."),
      ],
    });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.bringToLife();

    // De gesprekspartner valt Animus in de rede na het eerste stukje tekst.
    for await (const event of brain.hear("Mijn kat heet Mimi.")) {
      if (event.type === "text") break;
    }
    await collectText(brain.hear("Hoe heet mijn kat?"));

    const secondTurn = JSON.stringify(light.doStreamCalls[1]?.prompt);
    expect(secondTurn).toContain("Mijn kat heet Mimi.");
    expect(secondTurn).toContain("Wat een mooie ");
    const rows = await db.select().from(memories);
    expect(rows.some((row) => row.text.includes("Mijn kat heet Mimi."))).toBe(true);
  });

  describe("Wakker en Slapend", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");

    function genesisTwice(first: string, second: string) {
      return new MockLanguageModelV4({
        doGenerate: [
          generateResult(JSON.stringify({ name: first, coreCharacter: "x", birthStory: "y", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
          generateResult(JSON.stringify({ name: second, coreCharacter: "x", birthStory: "y", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
        ],
      });
    }

    function brainWith(type2: { light: MockLanguageModelV4; heavy: MockLanguageModelV4 }, options: { now?: () => Date } = {}) {
      const type1 = type1Model();
      const brain = createBrain({
        db,
        embedder: embedModel(),
        type1,
        type2,
        now: options.now ?? (() => bornAt),
        random: () => 0,
      });
      return { brain, type1 };
    }

    async function awakeNames(): Promise<string[]> {
      const rows = await db.select().from(dynimos).where(isNotNull(dynimos.awakeSince));
      return rows.map((row) => row.name);
    }

    it("laat bringToLife() een eerder wakkere Dynimo slapen leggen", async () => {
      const { brain } = brainWith({ light: unusedModel(), heavy: genesisTwice("Nova", "Lumen") });

      await brain.bringToLife();
      await brain.bringToLife();

      expect(await awakeNames()).toEqual(["Lumen"]);
      expect(await db.select().from(dynimos)).toHaveLength(2);
    });

    it("laat wake(B) Dynimo A slapen leggen en geeft een onbekende id null", async () => {
      const { brain } = brainWith({ light: unusedModel(), heavy: genesisTwice("Nova", "Lumen") });
      const nova = await brain.bringToLife();
      const lumen = await brain.bringToLife();

      const woken = await brain.wake(nova.id);

      expect(woken?.name).toBe("Nova");
      expect(woken?.awakeSince).toEqual(bornAt);
      expect(await awakeNames()).toEqual(["Nova"]);
      expect(await brain.wake(lumen.id + 999)).toBeNull();
      expect(await awakeNames()).toEqual(["Nova"]);
    });

    it("ververst awake_since niet als wake() een al wakkere Dynimo wekt", async () => {
      let clock = bornAt;
      const { brain } = brainWith({ light: unusedModel(), heavy: genesisTwice("Nova", "Lumen") }, { now: () => clock });
      const nova = await brain.bringToLife();
      clock = new Date(bornAt.getTime() + 60_000);

      const woken = await brain.wake(nova.id);

      expect(woken?.awakeSince).toEqual(bornAt);
      expect((await db.select().from(dynimos))[0]?.awakeSince).toEqual(bornAt);
    });

    it("houdt hooguit één Dynimo wakker bij gelijktijdig wake() en gelijktijdig bringToLife()", async () => {
      const { brain } = brainWith({ light: unusedModel(), heavy: genesisTwice("Nova", "Lumen") });
      const nova = await brain.bringToLife();
      const lumen = await brain.bringToLife();

      await Promise.all([brain.wake(nova.id), brain.wake(lumen.id)]);
      expect(await awakeNames()).toHaveLength(1);

      const two = brainWith({ light: unusedModel(), heavy: genesisTwice("Vero", "Mira") });
      await Promise.all([two.brain.bringToLife(), two.brain.bringToLife()]);
      expect(await awakeNames()).toHaveLength(1);
      expect(await db.select().from(dynimos)).toHaveLength(4);
    });

    it("levert na sleep() niemand wakker: hear() geeft niets en roept geen enkel model aan", async () => {
      const light = unusedModel();
      const heavy = genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" });
      const { brain, type1 } = brainWith({ light, heavy });
      await brain.bringToLife();

      await brain.sleep();
      await brain.sleep(); // idempotent

      const events: BrainEvent[] = [];
      for await (const event of brain.hear("Hallo?")) events.push(event);
      expect(events).toEqual([]);
      expect(await awakeNames()).toEqual([]);
      expect(type1.doEvaluateCalls).toHaveLength(0);
      expect(light.doStreamCalls).toHaveLength(0);
      expect(heavy.doGenerateCalls).toHaveLength(1); // enkel de genesis
    });

    it("heeft na sleep() en wake() een leeg Werkgeheugen, maar recall vindt de Herinneringen nog", async () => {
      const light = new MockLanguageModelV4({ doStream: [textStream("Leuk."), textStream("Mimi.")] });
      const { brain } = brainWith({ light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) });
      const nova = await brain.bringToLife();
      await collectText(brain.hear("Mijn kat heet Mimi."));

      await brain.sleep();
      await brain.wake(nova.id);
      await collectText(brain.hear("Hoe heet mijn kat?"));

      const prompt = light.doStreamCalls[1]?.prompt;
      expect(contentsByRole(prompt, "user").join(" ")).not.toContain("Mijn kat heet Mimi.");
      expect(contentsByRole(prompt, "system").join(" ")).toContain("Mijn kat heet Mimi.");
    });

    it("leegt het Werkgeheugen van een pratende instantie als een andere instantie dezelfde Dynimo laat slapen en wekken", async () => {
      let clock = bornAt;
      const manager = brainWith({ light: unusedModel(), heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) }, { now: () => clock });
      const nova = await manager.brain.bringToLife();
      const light = new MockLanguageModelV4({ doStream: [textStream("Leuk."), textStream("Mimi.")] });
      const talker = brainWith({ light, heavy: unusedModel() }, { now: () => clock });
      await collectText(talker.brain.hear("Mijn kat heet Mimi."));

      clock = new Date(bornAt.getTime() + 60_000);
      await manager.brain.sleep();
      await manager.brain.wake(nova.id);
      await collectText(talker.brain.hear("Hoe heet mijn kat?"));

      const prompt = light.doStreamCalls[1]?.prompt;
      expect(contentsByRole(prompt, "user").join(" ")).not.toContain("Mijn kat heet Mimi.");
      expect(contentsByRole(prompt, "system").join(" ")).toContain("Mijn kat heet Mimi."); // recall vindt hem wel
    });

    it("laat Dynimo's elkaars Herinneringen niet zien", async () => {
      const light = new MockLanguageModelV4({
        doStream: [textStream("Leuk."), textStream("Lekker."), textStream("Mimi."), textStream("Pizza.")],
      });
      const { brain } = brainWith({ light, heavy: genesisTwice("Nova", "Lumen") });
      const nova = await brain.bringToLife();
      await collectText(brain.hear("Mijn kat heet Mimi."));
      const lumen = await brain.bringToLife();
      await collectText(brain.hear("Ik hou van pizza."));

      await brain.wake(nova.id);
      await collectText(brain.hear("Wat weet je nog?"));
      const novaSystem = contentsByRole(light.doStreamCalls[2]?.prompt, "system").join(" ");
      expect(novaSystem).toContain("Mijn kat heet Mimi.");
      expect(novaSystem).not.toContain("pizza");

      await brain.wake(lumen.id);
      await collectText(brain.hear("Wat weet je nog?"));
      const lumenSystem = contentsByRole(light.doStreamCalls[3]?.prompt, "system").join(" ");
      expect(lumenSystem).toContain("Ik hou van pizza.");
      expect(lumenSystem).not.toContain("Mimi");
    });

    it("weigert in Postgres zelf een tweede wakkere rij, maar staat een wakkere plus slapende rij toe", async () => {
      const row = { coreCharacter: "x", birthStory: "y", seed: "z", bornAt: new Date("2026-01-01T12:00:00.000Z") };
      await db.insert(dynimos).values({ ...row, name: "Nova", awakeSince: row.bornAt });
      await db.insert(dynimos).values({ ...row, name: "Slaper" });

      await expect(db.insert(dynimos).values({ ...row, name: "Lumen", awakeSince: row.bornAt })).rejects.toThrow();
      expect(await db.select().from(dynimos)).toHaveLength(2);
      await expect(
        db.insert(dynimos).values({ ...row, name: "Lumen", awakeSince: row.bornAt }),
      ).rejects.toMatchObject({ cause: { constraint_name: "dynimos_single_awake_idx" } });
    });

    it("geeft met list() alle levende Dynimo's, gesorteerd op id", async () => {
      const { brain } = brainWith({ light: unusedModel(), heavy: genesisTwice("Nova", "Lumen") });
      expect(await brain.list()).toEqual([]);
      const nova = await brain.bringToLife();
      const lumen = await brain.bringToLife();

      const rows = await brain.list();

      expect(rows.map((row) => row.id)).toEqual([nova.id, lumen.id]);
      expect(rows.map((row) => row.name)).toEqual(["Nova", "Lumen"]);
      expect(rows[1]?.awakeSince).toEqual(bornAt);
      expect(rows[0]?.awakeSince).toBeNull();
    });

    it("maakt bij hear() op een lege database geen Dynimo aan en roept geen model aan", async () => {
      const light = unusedModel();
      const heavy = unusedModel();
      const { brain, type1 } = brainWith({ light, heavy });

      const events: BrainEvent[] = [];
      for await (const event of brain.hear("Hallo?")) events.push(event);

      expect(events).toEqual([]);
      expect(await db.select().from(dynimos)).toHaveLength(0);
      expect(type1.doEvaluateCalls).toHaveLength(0);
      expect(light.doStreamCalls).toHaveLength(0);
      expect(heavy.doGenerateCalls).toHaveLength(0);
    });
  });

  describe("toestandsnotificaties", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Aparte connectie die luistert zoals de agent zal doen; Postgres levert pas na commit.
    async function listen() {
      const client = postgres(databaseUrl(TEST_DB_NAME), { onnotice: () => {} });
      const received: string[] = [];
      await client.listen(STATE_CHANNEL, (payload) => received.push(payload));
      const settle = async () => {
        await pause(150);
        return received.length;
      };
      return { received, settle, close: () => client.end() };
    }

    function twoDynimosBrain() {
      const heavy = new MockLanguageModelV4({
        doGenerate: [
          generateResult(JSON.stringify({ name: "Nova", coreCharacter: "x", birthStory: "y", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
          generateResult(JSON.stringify({ name: "Lumen", coreCharacter: "x", birthStory: "y", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
          generateResult("Vaarwel."),
        ],
      });
      return createBrain({
        db,
        embedder: embedModel(),
        type1: type1Model(),
        type2: { light: unusedModel(), heavy },
        now: () => bornAt,
        random: () => 0,
      });
    }

    it("meldt bringToLife() op het toestandskanaal", async () => {
      const brain = twoDynimosBrain();
      const listener = await listen();
      try {
        await brain.bringToLife();
        expect(await listener.settle()).toBe(1);
      } finally {
        await listener.close();
      }
    });

    it("meldt wake() van een andere Dynimo, maar niet wake() van een al wakkere", async () => {
      const brain = twoDynimosBrain();
      const nova = await brain.bringToLife();
      await brain.bringToLife();
      const listener = await listen();
      try {
        await brain.wake(nova.id);
        expect(await listener.settle()).toBe(1);
        await brain.wake(nova.id);
        expect(await listener.settle()).toBe(1);
      } finally {
        await listener.close();
      }
    });

    it("meldt sleep() op het toestandskanaal", async () => {
      const brain = twoDynimosBrain();
      await brain.bringToLife();
      const listener = await listen();
      try {
        await brain.sleep();
        expect(await listener.settle()).toBe(1);
      } finally {
        await listener.close();
      }
    });

    it("meldt kill() enkel als er echt iets gedood is", async () => {
      const brain = twoDynimosBrain();
      const nova = await brain.bringToLife();
      const listener = await listen();
      try {
        expect(await brain.kill(nova.id, "Fout")).toBeNull();
        expect(await listener.settle()).toBe(0);
        await brain.kill(nova.id, "Nova");
        expect(await listener.settle()).toBe(1);
      } finally {
        await listener.close();
      }
    });
  });

  describe("onderbroken beurten", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");

    function setup(light: MockLanguageModelV4) {
      return createBrain({
        db,
        embedder: embedModel(),
        type1: type1Model(),
        type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
        now: () => bornAt,
        random: () => 0,
      });
    }

    function streamOf(...deltas: string[]) {
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "1" },
            ...deltas.map((delta) => ({ type: "text-delta" as const, id: "1", delta })),
            { type: "text-end" as const, id: "1" },
            { type: "finish" as const, usage: NULL_USAGE, finishReason: STOP },
          ],
        }),
      };
    }

    it("breekt de LLM-stream af (abortSignal) als de consument vroegtijdig stopt", async () => {
      const light = new MockLanguageModelV4({ doStream: [streamOf("Wat een ", "mooie naam.")] });
      const brain = setup(light);
      await brain.bringToLife();

      for await (const event of brain.hear("Mijn kat heet Mimi.")) {
        if (event.type === "text") break;
      }

      expect(light.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
    });

    it("breekt de LLM-stream niet af na een normaal afgeronde beurt", async () => {
      const light = new MockLanguageModelV4({ doStream: [streamOf("Hoi.")] });
      const brain = setup(light);
      await brain.bringToLife();

      await collectText(brain.hear("Hallo!"));

      expect(light.doStreamCalls[0]?.abortSignal).toBeDefined();
      expect(light.doStreamCalls[0]?.abortSignal?.aborted).toBe(false);
    });

    it("rondt een beurt netjes af als de Dynimo halverwege door een andere instantie gedood wordt", async () => {
      const killer = createBrain({
        db,
        embedder: embedModel(),
        type1: type1Model(),
        type2: {
          light: unusedModel(),
          heavy: new MockLanguageModelV4({
            doGenerate: [
              generateResult(JSON.stringify({ name: "Nova", coreCharacter: "x", birthStory: "y", axes: MID_AXES, drives: MID_DRIVES, baseEmotion: "kalm" })),
              generateResult("Vaarwel."),
            ],
          }),
        },
        now: () => bornAt,
        random: () => 0,
      });
      const nova = await killer.bringToLife();
      const talker = setup(new MockLanguageModelV4({ doStream: [streamOf("Wat een ", "mooie naam.")] }));

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const iterator = talker.hear("Mijn kat heet Mimi.")[Symbol.asyncIterator]();
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || value.type === "text") break;
        }
        await killer.kill(nova.id, "Nova");
        await expect(iterator.return?.()).resolves.toBeDefined();
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(unhandled).toEqual([]);
      expect(await db.select().from(memories)).toHaveLength(0);
    });
  });

  describe("Persoonlijkheid", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const INTROVERT = { ie: 0.1, sn: 0.5, tf: 0.5, jp: 0.5 };
    const EXTRAVERT = { ie: 0.9, sn: 0.5, tf: 0.5, jp: 0.5 };

    function brainWith(type2: { light: MockLanguageModelV4; heavy: MockLanguageModelV4 }) {
      return createBrain({
        db,
        embedder: embedModel(),
        type1: type1Model(),
        type2,
        now: () => bornAt,
        random: () => 0,
      });
    }

    async function insertDynimo(axes?: { ie: number; sn: number; tf: number; jp: number }) {
      const [row] = await db
        .insert(dynimos)
        .values({
          name: "Vero",
          coreCharacter: "Rustig.",
          birthStory: "Geboren.",
          seed: "z",
          bornAt,
          awakeSince: bornAt,
          axisIe: axes?.ie,
          axisSn: axes?.sn,
          axisTf: axes?.tf,
          axisJp: axes?.jp,
        })
        .returning();
      return row!;
    }

    it("bewaart de assen uit de genesis-call op de nieuwe Dynimo", async () => {
      const axes = { ie: 0.1, sn: 0.9, tf: 0.2, jp: 0.8 };
      const brain = brainWith({
        light: unusedModel(),
        heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y", axes }),
      });

      const nova = await brain.bringToLife();

      expect([nova.axisIe, nova.axisSn, nova.axisTf, nova.axisJp]).toEqual([0.1, 0.9, 0.2, 0.8].map((v) => expect.closeTo(v)));
      const [row] = await db.select().from(dynimos);
      expect(row?.axisIe).toBeCloseTo(0.1);
      expect(row?.axisJp).toBeCloseTo(0.8);
    });

    it("faalt bringToLife() zonder rij als de genesis assen buiten 0..1 geeft", async () => {
      const brain = brainWith({
        light: unusedModel(),
        heavy: genesisModel({
          name: "Nova",
          coreCharacter: "x",
          birthStory: "y",
          axes: { ie: 1.5, sn: 0.5, tf: 0.5, jp: 0.5 },
        }),
      });

      await expect(brain.bringToLife()).rejects.toThrow();
      expect(await db.select().from(dynimos)).toHaveLength(0);
    });

    it("geeft een introverte Dynimo de korte-antwoorden-richtlijn en niet de extraverte", async () => {
      await insertDynimo(INTROVERT);
      const light = textModel(["Hoi."]);
      await collectText(brainWith({ light, heavy: unusedModel() }).hear("Hallo!"));

      const system = contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ");
      expect(system).toContain("Persoonlijkheid: INFP");
      expect(system).toContain("één korte zin");
      expect(system).not.toContain("uitweiden");
    });

    it("geeft een extraverte Dynimo de uitweid-richtlijn en niet de introverte", async () => {
      await insertDynimo(EXTRAVERT);
      const light = textModel(["Hoi."]);
      await collectText(brainWith({ light, heavy: unusedModel() }).hear("Hallo!"));

      const system = contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ");
      expect(system).toContain("Persoonlijkheid: ENFP");
      expect(system).toContain("uitweiden");
      expect(system).not.toContain("één korte zin");
    });

    it("bewaart de exacte randwaarden 0 en 1 uit de genesis en behandelt 0 niet als ontbrekend", async () => {
      const brain = brainWith({
        light: textModel(["Hoi."]),
        heavy: genesisModel({
          name: "Nova",
          coreCharacter: "x",
          birthStory: "y",
          axes: { ie: 0, sn: 1, tf: 0, jp: 1 },
        }),
      });
      const nova = await brain.bringToLife();
      expect([nova.axisIe, nova.axisSn, nova.axisTf, nova.axisJp]).toEqual([0, 1, 0, 1]);

      const light = textModel(["Hoi."]);
      await collectText(brainWith({ light, heavy: unusedModel() }).hear("Hallo!"));
      expect(contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ")).toContain("Persoonlijkheid: INTP");
    });

    it("laat het persoonlijkheidsblok weg bij een Dynimo zonder assen", async () => {
      await insertDynimo();
      const light = textModel(["Hoi."]);
      await collectText(brainWith({ light, heavy: unusedModel() }).hear("Hallo!"));

      expect(contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ")).not.toContain("Persoonlijkheid");
    });
  });

  describe("backfill", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const AXES_RESULT = { axes: { ie: 0.2, sn: 0.8, tf: 0.7, jp: 0.3 } };

    function brainWith(heavy: MockLanguageModelV4, light: MockLanguageModelV4 = unusedModel()) {
      return createBrain({
        db,
        embedder: embedModel(),
        type1: type1Model(),
        type2: { light, heavy },
        now: () => bornAt,
        random: () => 0,
      });
    }

    // Een fase-1-achtige rij: geen assen.
    async function insertLegacy(
      name: string,
      extra: Partial<typeof dynimos.$inferInsert> = {},
      options: { withDrive?: boolean } = {},
    ) {
      const [row] = await db
        .insert(dynimos)
        .values({ name, coreCharacter: `Kern van ${name}.`, birthStory: "Geboren.", seed: "z", bornAt, baseEmotion: "kalm", ...extra })
        .returning();
      // Standaard mét Drijfveer, zodat alleen de assen-stap iets te doen heeft.
      if (options.withDrive ?? true) {
        await db.insert(drives).values({ dynimoId: row!.id, kind: "wens", text: "Een wens", createdAt: bornAt, updatedAt: bornAt });
      }
      return row!;
    }

    it("vult de assen van een Dynimo zonder assen aan", async () => {
      const legacy = await insertLegacy("Lumi");
      const heavy = new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(AXES_RESULT))] });

      expect(await brainWith(heavy).backfill()).toBe(1);

      const [row] = await db.select().from(dynimos).where(eq(dynimos.id, legacy.id));
      expect([row?.axisIe, row?.axisSn, row?.axisTf, row?.axisJp]).toEqual([0.2, 0.8, 0.7, 0.3].map((v) => expect.closeTo(v)));
    });

    it("geeft Kernkarakter, Geëvolueerd karakter en Herinneringen mee aan de backfillcall", async () => {
      const legacy = await insertLegacy("Lumi", { evolvedCharacter: "Groeide zachter." });
      await db
        .insert(memories)
        .values({ dynimoId: legacy.id, text: "Gesprekspartner: kat Mimi", embedding: fakeVector("kat"), createdAt: bornAt });
      const heavy = new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(AXES_RESULT))] });

      await brainWith(heavy).backfill();

      const prompt = JSON.stringify(heavy.doGenerateCalls[0]?.prompt);
      expect(prompt).toContain("Kern van Lumi.");
      expect(prompt).toContain("Groeide zachter.");
      expect(prompt).toContain("kat Mimi");
    });

    it("doet bij een tweede backfill() geen Type2-call meer", async () => {
      await insertLegacy("Lumi");
      const heavy = new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(AXES_RESULT))] });
      const brain = brainWith(heavy);

      await brain.backfill();
      expect(await brain.backfill()).toBe(0);

      expect(heavy.doGenerateCalls).toHaveLength(1);
    });

    it("slaat een Dynimo met assen over", async () => {
      await insertLegacy("Lumi", { axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5 });
      const heavy = unusedModel();

      expect(await brainWith(heavy).backfill()).toBe(0);
      expect(heavy.doGenerateCalls).toHaveLength(0);
    });

    it("laat bij een fout voor één Dynimo die rij NULL en gaat door met de volgende", async () => {
      const first = await insertLegacy("Eerste");
      const second = await insertLegacy("Tweede");
      let calls = 0;
      const heavy = new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          if (calls === 1) throw new Error("model plat");
          return generateResult(JSON.stringify(AXES_RESULT));
        },
      });

      expect(await brainWith(heavy).backfill()).toBe(1);

      const rows = await db.select().from(dynimos).orderBy(dynimos.id);
      expect(rows.find((row) => row.id === first.id)?.axisIe).toBeNull();
      expect(rows.find((row) => row.id === second.id)?.axisIe).toBeCloseTo(0.2);
    });

    it("bewaart de randwaarden 0 en 1 bij backfill", async () => {
      await insertLegacy("Lumi");
      const heavy = new MockLanguageModelV4({
        doGenerate: [generateResult(JSON.stringify({ axes: { ie: 0, sn: 1, tf: 0, jp: 1 } }))],
      });

      expect(await brainWith(heavy).backfill()).toBe(1);

      const [row] = await db.select().from(dynimos);
      expect([row?.axisIe, row?.axisSn, row?.axisTf, row?.axisJp]).toEqual([0, 1, 0, 1]);
    });

    it("laat de rij NULL bij ongeldige Type2-output (as buiten 0..1) en gaat door met de volgende", async () => {
      const first = await insertLegacy("Eerste");
      const second = await insertLegacy("Tweede");
      const heavy = new MockLanguageModelV4({
        doGenerate: [
          generateResult(JSON.stringify({ axes: { ie: 1.5, sn: 0.5, tf: 0.5, jp: 0.5 } })),
          generateResult(JSON.stringify(AXES_RESULT)),
        ],
      });

      expect(await brainWith(heavy).backfill()).toBe(1);

      const rows = await db.select().from(dynimos);
      expect(rows.find((row) => row.id === first.id)?.axisIe).toBeNull();
      expect(rows.find((row) => row.id === second.id)?.axisIe).toBeCloseTo(0.2);
    });

    it("overschrijft assen niet die intussen door een andere instantie gezet zijn", async () => {
      const legacy = await insertLegacy("Lumi");
      const heavy = new MockLanguageModelV4({
        doGenerate: async () => {
          // Een andere instantie was ons voor terwijl de call liep.
          await db.update(dynimos).set({ axisIe: 0.9, axisSn: 0.9, axisTf: 0.9, axisJp: 0.9 }).where(eq(dynimos.id, legacy.id));
          return generateResult(JSON.stringify(AXES_RESULT));
        },
      });

      expect(await brainWith(heavy).backfill()).toBe(0);

      const [row] = await db.select().from(dynimos);
      expect(row?.axisIe).toBeCloseTo(0.9);
    });

    it("werkt een pratende instantie meteen bij: de persoonlijkheid komt in de volgende beurt zonder herstart", async () => {
      await insertLegacy("Lumi", { awakeSince: bornAt });
      const light = new MockLanguageModelV4({ doStream: [textStream("Hoi."), textStream("Hallo.")] });
      const talker = brainWith(unusedModel(), light);
      await collectText(talker.hear("Hallo!"));
      expect(contentsByRole(light.doStreamCalls[0]?.prompt, "system").join(" ")).not.toContain("Persoonlijkheid");

      await brainWith(new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(AXES_RESULT))] })).backfill();
      await collectText(talker.hear("Nog een keer."));

      expect(contentsByRole(light.doStreamCalls[1]?.prompt, "system").join(" ")).toContain("Persoonlijkheid: INFJ");
    });
  });

  describe("Drijfveren", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const DRIVES_RESULT = {
      drives: {
        wens: [{ text: "Sterren tellen" }],
        doel: [{ text: "Een lied leren" }, { text: "Een vriend maken" }],
        toekomstdroom: [{ text: "Een vuurtoren zijn" }],
        afkeer: [{ text: "Stilstaand water", strength: 0.9 }],
        ergernis: [{ text: "Tikkende klokken", strength: 0.2 }],
      },
    };

    function brainWith(heavy: MockLanguageModelV4, light: MockLanguageModelV4 = unusedModel()) {
      return createBrain({
        db,
        embedder: embedModel(),
        type1: type1Model(),
        type2: { light, heavy },
        now: () => bornAt,
        random: () => 0,
      });
    }

    async function insertDynimo(name = "Vero", awake = true) {
      const [row] = await db
        .insert(dynimos)
        .values({
          name,
          coreCharacter: `Kern van ${name}.`,
          birthStory: "Geboren.",
          seed: "z",
          bornAt,
          baseEmotion: "kalm",
          awakeSince: awake ? bornAt : null,
        })
        .returning();
      return row!;
    }

    async function insertDrive(
      dynimoId: number,
      kind: "wens" | "doel" | "toekomstdroom" | "afkeer" | "ergernis",
      text: string,
      extra: { status?: "actief" | "bereikt" | "opgegeven"; strength?: number } = {},
    ) {
      await db.insert(drives).values({
        dynimoId,
        kind,
        text,
        status: kind === "doel" ? (extra.status ?? "actief") : null,
        strength: kind === "afkeer" || kind === "ergernis" ? (extra.strength ?? 0.5) : null,
        createdAt: bornAt,
        updatedAt: bornAt,
      });
    }

    async function systemOfFirstTurn(light: MockLanguageModelV4, index = 0) {
      return contentsByRole(light.doStreamCalls[index]?.prompt, "system").join(" ");
    }

    it("bewaart de Drijfveren uit de genesis-call, met Doelen actief en sterkte bij Afkeer en Ergernis", async () => {
      const brain = brainWith(
        new MockLanguageModelV4({
          doGenerate: [
            generateResult(JSON.stringify({ name: "Nova", coreCharacter: "x", birthStory: "y", axes: MID_AXES, baseEmotion: "kalm", ...DRIVES_RESULT })),
          ],
        }),
      );

      const nova = await brain.bringToLife();

      const rows = await db.select().from(drives).orderBy(drives.id);
      expect(rows.every((row) => row.dynimoId === nova.id)).toBe(true);
      expect(rows.map((row) => `${row.kind}:${row.text}`)).toEqual([
        "wens:Sterren tellen",
        "doel:Een lied leren",
        "doel:Een vriend maken",
        "toekomstdroom:Een vuurtoren zijn",
        "afkeer:Stilstaand water",
        "ergernis:Tikkende klokken",
      ]);
      expect(rows.filter((row) => row.kind === "doel").every((row) => row.status === "actief")).toBe(true);
      expect(rows.find((row) => row.kind === "afkeer")?.strength).toBeCloseTo(0.9);
      expect(rows.find((row) => row.kind === "wens")?.strength).toBeNull();
    });

    it.each([
      ["een soort zonder items", { ...DRIVES_RESULT.drives, wens: [] }],
      ["drie items in een soort", { ...DRIVES_RESULT.drives, wens: [{ text: "a" }, { text: "b" }, { text: "c" }] }],
      ["een sterkte buiten 0..1", { ...DRIVES_RESULT.drives, afkeer: [{ text: "Kou", strength: 1.5 }] }],
      ["een lege tekst", { ...DRIVES_RESULT.drives, wens: [{ text: "" }] }],
    ])("faalt bringToLife() zonder Dynimo of Drijfveren bij %s", async (_label, badDrives) => {
      const brain = brainWith(
        new MockLanguageModelV4({
          doGenerate: [
            generateResult(JSON.stringify({ name: "Nova", coreCharacter: "x", birthStory: "y", axes: MID_AXES, baseEmotion: "kalm", drives: badDrives })),
          ],
        }),
      );

      await expect(brain.bringToLife()).rejects.toThrow();
      expect(await db.select().from(dynimos)).toHaveLength(0);
      expect(await db.select().from(drives)).toHaveLength(0);
    });

    it("zet actieve Drijfveren in het stabiele deel, maar bereikte en opgegeven Doelen niet", async () => {
      const vero = await insertDynimo();
      await insertDrive(vero.id, "wens", "Een lentewens");
      await insertDrive(vero.id, "doel", "Lopend doel");
      await insertDrive(vero.id, "doel", "Afgerond doel", { status: "bereikt" });
      await insertDrive(vero.id, "doel", "Losgelaten doel", { status: "opgegeven" });
      await insertDrive(vero.id, "afkeer", "Harde kou", { strength: 0.9 });
      const light = textModel(["Hoi."]);

      await collectText(brainWith(unusedModel(), light).hear("Hallo!"));

      const system = await systemOfFirstTurn(light);
      expect(system).toContain("Een lentewens");
      expect(system).toContain("Lopend doel");
      expect(system).toContain("Harde kou (sterk)");
      expect(system).not.toContain("Afgerond doel");
      expect(system).not.toContain("Losgelaten doel");
    });

    it("laat geen Drijfvereblok zien voor een Dynimo zonder Drijfveren", async () => {
      await insertDynimo();
      const light = textModel(["Hoi."]);
      await collectText(brainWith(unusedModel(), light).hear("Hallo!"));
      expect(await systemOfFirstTurn(light)).not.toContain("Wat je wilt en niet wilt");
    });

    it("toont de Drijfveren van een andere Dynimo niet", async () => {
      const vero = await insertDynimo("Vero");
      const other = await insertDynimo("Mira", false);
      await insertDrive(vero.id, "wens", "Veros wens");
      await insertDrive(other.id, "wens", "Mira's geheime wens");
      const light = textModel(["Hoi."]);

      await collectText(brainWith(unusedModel(), light).hear("Hallo!"));

      const system = await systemOfFirstTurn(light);
      expect(system).toContain("Veros wens");
      expect(system).not.toContain("Mira's geheime wens");
    });

    it("werkt een wijziging door een ander proces meteen door, zonder herstart", async () => {
      const vero = await insertDynimo();
      const light = new MockLanguageModelV4({ doStream: [textStream("Hoi."), textStream("Hallo.")] });
      const talker = brainWith(unusedModel(), light);
      await collectText(talker.hear("Eerste."));
      expect(await systemOfFirstTurn(light, 0)).not.toContain("Nieuwe wens");

      await insertDrive(vero.id, "wens", "Nieuwe wens");
      await collectText(talker.hear("Tweede."));

      expect(await systemOfFirstTurn(light, 1)).toContain("Nieuwe wens");
    });

    it("geeft de Drijfveren mee aan de Afscheidsreflectie", async () => {
      const vero = await insertDynimo();
      await insertDrive(vero.id, "toekomstdroom", "Een vuurtoren zijn");
      const heavy = new MockLanguageModelV4({ doGenerate: [generateResult("Vaarwel.")] });

      await brainWith(heavy).kill(vero.id, "Vero");

      expect(JSON.stringify(heavy.doGenerateCalls[0]?.prompt)).toContain("Een vuurtoren zijn");
    });

    it("wist bij kill() enkel de Drijfveren van het gedoode wezen", async () => {
      const vero = await insertDynimo("Vero");
      const mira = await insertDynimo("Mira", false);
      await insertDrive(vero.id, "wens", "Veros wens");
      await insertDrive(mira.id, "wens", "Mira's wens");
      const heavy = new MockLanguageModelV4({ doGenerate: [generateResult("Vaarwel.")] });

      await brainWith(heavy).kill(vero.id, "Vero");

      expect((await db.select().from(drives)).map((row) => row.text)).toEqual(["Mira's wens"]);
    });

    describe("backfill", () => {
      async function withoutDrives(name = "Lumi") {
        const row = await insertDynimo(name, false);
        await db.update(dynimos).set({ axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5 }).where(eq(dynimos.id, row.id));
        return row;
      }

      it("vult Drijfveren aan voor een Dynimo zonder Drijfveren", async () => {
        const lumi = await withoutDrives();
        const heavy = new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(DRIVES_RESULT))] });

        expect(await brainWith(heavy).backfill()).toBe(1);

        const rows = await db.select().from(drives).where(eq(drives.dynimoId, lumi.id));
        expect(rows).toHaveLength(6);
        expect(rows.filter((row) => row.kind === "doel").every((row) => row.status === "actief")).toBe(true);
      });

      it("geeft Kernkarakter, Persoonlijkheid en Herinneringen mee aan de backfillcall", async () => {
        const lumi = await withoutDrives();
        await db.update(dynimos).set({ axisIe: 0.1, axisSn: 0.1, axisTf: 0.1, axisJp: 0.1 }).where(eq(dynimos.id, lumi.id));
        await db
          .insert(memories)
          .values({ dynimoId: lumi.id, text: "Gesprekspartner: kat Mimi", embedding: fakeVector("kat"), createdAt: bornAt });
        const heavy = new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(DRIVES_RESULT))] });

        await brainWith(heavy).backfill();

        const prompt = JSON.stringify(heavy.doGenerateCalls[0]?.prompt);
        expect(prompt).toContain("Kern van Lumi.");
        expect(prompt).toContain("kat Mimi");
        expect(prompt).toContain("ISTJ");
      });

      it("doet bij een tweede backfill() geen Type2-call meer", async () => {
        await withoutDrives();
        const heavy = new MockLanguageModelV4({ doGenerate: [generateResult(JSON.stringify(DRIVES_RESULT))] });
        const brain = brainWith(heavy);

        await brain.backfill();
        expect(await brain.backfill()).toBe(0);

        expect(heavy.doGenerateCalls).toHaveLength(1);
      });

      it("slaat een Dynimo met bestaande Drijfveren over", async () => {
        const lumi = await withoutDrives();
        await insertDrive(lumi.id, "wens", "Bestaande wens");
        const heavy = unusedModel();

        expect(await brainWith(heavy).backfill()).toBe(0);
        expect(heavy.doGenerateCalls).toHaveLength(0);
      });

      it("schrijft niets bij een fout of ongeldige output, en gaat door met de volgende Dynimo", async () => {
        const first = await withoutDrives("Eerste");
        const second = await withoutDrives("Tweede");
        const heavy = new MockLanguageModelV4({
          doGenerate: [
            generateResult(JSON.stringify({ drives: { ...DRIVES_RESULT.drives, wens: [] } })),
            generateResult(JSON.stringify(DRIVES_RESULT)),
          ],
        });

        expect(await brainWith(heavy).backfill()).toBe(1);

        const rows = await db.select().from(drives);
        expect(rows.some((row) => row.dynimoId === first.id)).toBe(false);
        expect(rows.filter((row) => row.dynimoId === second.id)).toHaveLength(6);
      });

      it("vult in één run zowel assen als Drijfveren aan, en de Drijfveren-prompt bevat de net bepaalde assen", async () => {
        const lumi = await insertDynimo("Lumi", false);
        const heavy = new MockLanguageModelV4({
          doGenerate: [
            generateResult(JSON.stringify({ axes: { ie: 0.2, sn: 0.8, tf: 0.7, jp: 0.3 } })),
            generateResult(JSON.stringify(DRIVES_RESULT)),
          ],
        });

        expect(await brainWith(heavy).backfill()).toBe(1);

        expect(heavy.doGenerateCalls).toHaveLength(2);
        expect(JSON.stringify(heavy.doGenerateCalls[1]?.prompt)).toContain("INFJ");
        const [row] = await db.select().from(dynimos).where(eq(dynimos.id, lumi.id));
        expect(row?.axisIe).toBeCloseTo(0.2);
        expect(await db.select().from(drives).where(eq(drives.dynimoId, lumi.id))).toHaveLength(6);
      });

      it("gebruikt in de Drijfveren-prompt de assen die een andere instantie tussen de stappen zette", async () => {
        const lumi = await insertDynimo("Lumi", false);
        let calls = 0;
        const heavy = new MockLanguageModelV4({
          doGenerate: async () => {
            calls++;
            if (calls === 1) {
              // Een andere instantie was ons voor met de assen; onze eigen assen-update raakt dan niets.
              await db.update(dynimos).set({ axisIe: 0.9, axisSn: 0.9, axisTf: 0.9, axisJp: 0.9 }).where(eq(dynimos.id, lumi.id));
              return generateResult(JSON.stringify({ axes: { ie: 0.2, sn: 0.8, tf: 0.7, jp: 0.3 } }));
            }
            return generateResult(JSON.stringify(DRIVES_RESULT));
          },
        });

        await brainWith(heavy).backfill();

        expect(JSON.stringify(heavy.doGenerateCalls[1]?.prompt)).toContain("ENFP");
        expect(await db.select().from(drives).where(eq(drives.dynimoId, lumi.id))).toHaveLength(6);
      });

      it("maakt maar één set Drijfveren bij twee gelijktijdige backfills", async () => {
        const lumi = await withoutDrives();
        const model = () =>
          new MockLanguageModelV4({
            doGenerate: async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return generateResult(JSON.stringify(DRIVES_RESULT));
            },
          });

        await Promise.all([brainWith(model()).backfill(), brainWith(model()).backfill()]);

        expect(await db.select().from(drives).where(eq(drives.dynimoId, lumi.id))).toHaveLength(6);
      });
    });
  });

  describe("Stemming en Basisemotie", () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const MIN = 60_000;

    // Type1 met een reeks antwoorden (één per beurt); registreert wat hij ontving.
    function type1Sequence(answers: { emotion: string; intensity: number }[]) {
      const calls: { state: string }[] = [];
      const model = new Experimental_EvaluationMockModelV4({
        doEvaluate: async (options) => {
          const answer = answers[calls.length] ?? answers.at(-1)!;
          calls.push({ state: String((options as { state: unknown }).state) });
          return {
            answers: {
              emotion: { type: "choice", choice: answer.emotion },
              intensity: { type: "score", score: answer.intensity },
              intent: { type: "choice", choice: "simpel" },
            },
            warnings: [],
          };
        },
      });
      return { model, calls };
    }

    function brainWith(options: {
      type1: Experimental_EvaluationMockModelV4;
      light: MockLanguageModelV4;
      heavy?: MockLanguageModelV4;
      now?: () => Date;
    }) {
      return createBrain({
        db,
        embedder: embedModel(),
        type1: options.type1,
        type2: { light: options.light, heavy: options.heavy ?? unusedModel() },
        now: options.now ?? (() => bornAt),
        random: () => 0,
      });
    }

    async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
      const [row] = await db
        .insert(dynimos)
        .values({
          name: "Vero",
          coreCharacter: "Rustig.",
          birthStory: "Geboren.",
          seed: "z",
          bornAt,
          awakeSince: bornAt,
          baseEmotion: "kalm",
          axisIe: 0.1,
          axisSn: 0.5,
          axisTf: 0.5,
          axisJp: 0.5,
          ...extra,
        })
        .returning();
      return row!;
    }

    const moodMessage = (light: MockLanguageModelV4, index: number) =>
      contentsByRole(light.doStreamCalls[index]?.prompt, "system").find((text) => text.includes("Je huidige stemming"));

    it("bewaart de Basisemotie uit de genesis-call", async () => {
      const brain = brainWith({
        type1: type1Model(),
        light: unusedModel(),
        heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y", baseEmotion: "nieuwsgierig" }),
      });

      expect((await brain.bringToLife()).baseEmotion).toBe("nieuwsgierig");
      expect((await db.select().from(dynimos))[0]?.baseEmotion).toBe("nieuwsgierig");
    });

    it("faalt bringToLife() zonder rij bij een ongeldige Basisemotie", async () => {
      const brain = brainWith({
        type1: type1Model(),
        light: unusedModel(),
        heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y", baseEmotion: "woedend" }),
      });

      await expect(brain.bringToLife()).rejects.toThrow();
      expect(await db.select().from(dynimos)).toHaveLength(0);
    });

    it("geeft Type1 de Persoonlijkheid, de actieve Drijfveren en de huidige Stemming mee", async () => {
      const vero = await insertDynimo({ moodEmotion: "boos", moodIntensity: 0.8, moodAt: bornAt });
      await db.insert(drives).values([
        { dynimoId: vero.id, kind: "wens", text: "Sterren tellen", createdAt: bornAt, updatedAt: bornAt },
        { dynimoId: vero.id, kind: "doel", text: "Afgerond doel", status: "bereikt", createdAt: bornAt, updatedAt: bornAt },
      ]);
      const { model, calls } = type1Sequence([{ emotion: "kalm", intensity: 0.1 }]);

      await collectText(brainWith({ type1: model, light: textModel(["Hoi."]) }).hear("Wat een dag."));

      const state = calls[0]!.state;
      expect(state).toContain("Wat een dag.");
      expect(state).toContain("Persoonlijkheid: INFP");
      expect(state).toContain("Sterren tellen");
      expect(state).not.toContain("Afgerond doel");
      expect(state).toContain("boos");
    });

    it("laat een zwakkere Emotie de sterkere Stemming niet vervangen, en een sterkere wel", async () => {
      await insertDynimo();
      const { model } = type1Sequence([
        { emotion: "boos", intensity: 0.8 },
        { emotion: "blij", intensity: 0.5 },
        { emotion: "blij", intensity: 0.9 },
      ]);
      const light = new MockLanguageModelV4({ doStream: [textStream("Een."), textStream("Twee."), textStream("Drie.")] });
      const brain = brainWith({ type1: model, light });

      const moods: BrainEvent[] = [];
      for (const utterance of ["Een", "Twee", "Drie"]) {
        for await (const event of brain.hear(utterance)) if (event.type === "mood") moods.push(event);
      }

      expect(moods).toEqual([
        { type: "mood", emotion: "boos", intensity: 0.8 },
        { type: "mood", emotion: "boos", intensity: 0.8 },
        { type: "mood", emotion: "blij", intensity: 0.9 },
      ]);
      expect((await db.select().from(dynimos))[0]?.moodEmotion).toBe("blij");
    });

    it("laat een Emotie die sterker is dan de uitgedoofde Stemming (maar zwakker dan de oorspronkelijke) winnen", async () => {
      let clock = bornAt;
      await insertDynimo();
      const { model } = type1Sequence([
        { emotion: "boos", intensity: 0.8 },
        { emotion: "blij", intensity: 0.5 },
      ]);
      const brain = brainWith({ type1: model, light: new MockLanguageModelV4({ doStream: [textStream("Een."), textStream("Twee.")] }), now: () => clock });

      await collectText(brain.hear("Een"));
      clock = new Date(bornAt.getTime() + 10 * MIN); // boos is nu uitgedoofd tot 0.4
      const events: BrainEvent[] = [];
      for await (const event of brain.hear("Twee")) events.push(event);

      expect(events[0]).toEqual({ type: "mood", emotion: "blij", intensity: 0.5 });
      const [row] = await db.select().from(dynimos);
      expect(row?.moodEmotion).toBe("blij");
      expect(row?.moodAt).toEqual(clock);
    });

    it("laat een Emotie die zwakker is dan de uitgedoofde Stemming die niet veranderen, en ververst mood_at niet", async () => {
      let clock = bornAt;
      await insertDynimo();
      const { model } = type1Sequence([
        { emotion: "boos", intensity: 0.8 },
        { emotion: "blij", intensity: 0.3 },
      ]);
      const brain = brainWith({ type1: model, light: new MockLanguageModelV4({ doStream: [textStream("Een."), textStream("Twee.")] }), now: () => clock });

      await collectText(brain.hear("Een"));
      clock = new Date(bornAt.getTime() + 10 * MIN); // boos is nu 0.4; blij 0.3 is zwakker
      const events: BrainEvent[] = [];
      for await (const event of brain.hear("Twee")) events.push(event);

      expect(events[0]?.type).toBe("mood");
      expect(events[0]).toMatchObject({ emotion: "boos" });
      expect((events[0] as { intensity: number }).intensity).toBeCloseTo(0.4);
      const [row] = await db.select().from(dynimos);
      expect(row?.moodEmotion).toBe("boos");
      expect(row?.moodAt).toEqual(bornAt);
    });

    it("ververst mood_at niet als de Stemming niet vervangen wordt", async () => {
      let clock = bornAt;
      await insertDynimo({ moodEmotion: "boos", moodIntensity: 0.8, moodAt: bornAt });
      const { model } = type1Sequence([{ emotion: "blij", intensity: 0.2 }]);
      clock = new Date(bornAt.getTime() + MIN);

      await collectText(brainWith({ type1: model, light: textModel(["Hoi."]), now: () => clock }).hear("Hoi"));

      expect((await db.select().from(dynimos))[0]?.moodAt).toEqual(bornAt);
    });

    it("geeft Type2 de Stemming als los system-bericht buiten het gecachete deel", async () => {
      await insertDynimo();
      const { model } = type1Sequence([{ emotion: "boos", intensity: 0.8 }]);
      const light = textModel(["Hoi."]);

      await collectText(brainWith({ type1: model, light }).hear("Hoi"));

      const systems = contentsByRole(light.doStreamCalls[0]?.prompt, "system");
      expect(systems[0]).not.toContain("Je huidige stemming");
      expect(moodMessage(light, 0)).toContain("boos");
      expect(moodMessage(light, 0)).toContain("0.80");
      expect(systems.indexOf(moodMessage(light, 0)!)).toBeGreaterThan(1); // na stabiel en leeftijd
    });

    it("dooft de intensiteit van de Stemming uit: na 10 minuten is ze gehalveerd", async () => {
      await insertDynimo({ moodEmotion: "boos", moodIntensity: 0.8, moodAt: bornAt });
      const { model } = type1Sequence([{ emotion: "blij", intensity: 0 }]);
      const light = textModel(["Hoi."]);
      const clock = new Date(bornAt.getTime() + 10 * MIN);

      await collectText(brainWith({ type1: model, light, now: () => clock }).hear("Hoi"));

      expect(moodMessage(light, 0)).toContain("boos");
      expect(moodMessage(light, 0)).toContain("0.40");
    });

    it("valt na lange tijd terug op de Basisemotie", async () => {
      await insertDynimo({ moodEmotion: "boos", moodIntensity: 0.8, moodAt: bornAt });
      const { model } = type1Sequence([{ emotion: "blij", intensity: 0 }]);
      const light = textModel(["Hoi."]);
      const clock = new Date(bornAt.getTime() + 60 * MIN);

      await collectText(brainWith({ type1: model, light, now: () => clock }).hear("Hoi"));

      expect(moodMessage(light, 0)).toContain("kalm");
      expect(moodMessage(light, 0)).toContain("0.30");
    });

    it("bewaart de Stemming over beurten en over een nieuwe brain-instantie", async () => {
      await insertDynimo();
      const first = type1Sequence([{ emotion: "boos", intensity: 0.8 }]);
      await collectText(brainWith({ type1: first.model, light: textModel(["Grr."]) }).hear("Jij!"));

      const second = type1Sequence([{ emotion: "blij", intensity: 0 }]);
      const light = textModel(["Hm."]);
      await collectText(brainWith({ type1: second.model, light }).hear("Sorry."));

      expect(moodMessage(light, 0)).toContain("boos");
      expect(moodMessage(light, 0)).toContain("0.80");
    });

    it("laat een mislukte Type1 de Stemming ongewijzigd", async () => {
      await insertDynimo({ moodEmotion: "boos", moodIntensity: 0.8, moodAt: bornAt });
      const broken = new Experimental_EvaluationMockModelV4({
        doEvaluate: async () => {
          throw new Error("Jev plat");
        },
      });
      const light = textModel(["Hoi."]);

      const events: BrainEvent[] = [];
      for await (const event of brainWith({ type1: broken, light }).hear("Hoi")) events.push(event);

      expect(events[0]).toEqual({ type: "mood", emotion: "boos", intensity: 0.8 });
      expect((await db.select().from(dynimos))[0]?.moodEmotion).toBe("boos");
    });

    describe("backfill van de Basisemotie", () => {
      const legacy = () => insertDynimo({ baseEmotion: null });
      const heavyWith = (...results: object[]) =>
        new MockLanguageModelV4({ doGenerate: results.map((result) => generateResult(JSON.stringify(result))) });

      it("vult de Basisemotie aan voor een Dynimo zonder", async () => {
        await legacy();
        const brain = brainWith({ type1: type1Model(), light: unusedModel(), heavy: heavyWith({ baseEmotion: "verveeld" }) });
        await db.insert(drives).values({ dynimoId: 1, kind: "wens", text: "Een wens", createdAt: bornAt, updatedAt: bornAt });

        expect(await brain.backfill()).toBe(1);

        expect((await db.select().from(dynimos))[0]?.baseEmotion).toBe("verveeld");
      });

      it("geeft Kernkarakter, Persoonlijkheid, Drijfveren en Herinneringen mee aan de call", async () => {
        const vero = await legacy();
        await db.insert(drives).values({ dynimoId: vero.id, kind: "wens", text: "Sterren tellen", createdAt: bornAt, updatedAt: bornAt });
        await db.insert(memories).values({ dynimoId: vero.id, text: "Gesprekspartner: kat Mimi", embedding: fakeVector("kat"), createdAt: bornAt });
        const heavy = heavyWith({ baseEmotion: "kalm" });

        await brainWith({ type1: type1Model(), light: unusedModel(), heavy }).backfill();

        const prompt = JSON.stringify(heavy.doGenerateCalls[0]?.prompt);
        expect(prompt).toContain("Rustig.");
        expect(prompt).toContain("INFP");
        expect(prompt).toContain("Sterren tellen");
        expect(prompt).toContain("kat Mimi");
      });

      it("doet een tweede backfill() niets, en slaat een Dynimo met Basisemotie over", async () => {
        const vero = await legacy();
        await db.insert(drives).values({ dynimoId: vero.id, kind: "wens", text: "Een wens", createdAt: bornAt, updatedAt: bornAt });
        const heavy = heavyWith({ baseEmotion: "bang" });
        const brain = brainWith({ type1: type1Model(), light: unusedModel(), heavy });

        await brain.backfill();
        expect(await brain.backfill()).toBe(0);

        expect(heavy.doGenerateCalls).toHaveLength(1);
      });

      it("laat de rij NULL bij ongeldige output (en gooit niet)", async () => {
        const vero = await legacy();
        await db.insert(drives).values({ dynimoId: vero.id, kind: "wens", text: "Een wens", createdAt: bornAt, updatedAt: bornAt });
        const brain = brainWith({ type1: type1Model(), light: unusedModel(), heavy: heavyWith({ baseEmotion: "woedend" }) });

        expect(await brain.backfill()).toBe(0);

        expect((await db.select().from(dynimos))[0]?.baseEmotion).toBeNull();
      });

      it("overschrijft geen Basisemotie die een andere instantie tussentijds zette", async () => {
        const vero = await legacy();
        await db.insert(drives).values({ dynimoId: vero.id, kind: "wens", text: "Een wens", createdAt: bornAt, updatedAt: bornAt });
        const heavy = new MockLanguageModelV4({
          doGenerate: async () => {
            await db.update(dynimos).set({ baseEmotion: "bang" }).where(eq(dynimos.id, vero.id));
            return generateResult(JSON.stringify({ baseEmotion: "blij" }));
          },
        });

        expect(await brainWith({ type1: type1Model(), light: unusedModel(), heavy }).backfill()).toBe(0);

        expect((await db.select().from(dynimos))[0]?.baseEmotion).toBe("bang");
      });
    });
  });
});
