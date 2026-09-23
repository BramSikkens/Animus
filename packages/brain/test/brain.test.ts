import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { eq } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, dynimos, epitaphs, memories } from "@animus/db/schema";
import { createBrain, type BrainEvent } from "../src/index.js";
import { createTestDb, truncateAll } from "./db.js";

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

function genesisModel(result: { name: string; coreCharacter: string; birthStory: string }) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
      generateResult(JSON.stringify({ name, coreCharacter: "Speels.", birthStory: "Geboren uit ochtendnevel." })),
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
  it("draait genesis bij de eerste boot() op een lege database", async () => {
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

    const result = await brain.boot();

    expect(result.name).toBe("Nova");
    expect(result.coreCharacter).toBe("Nieuwsgierig en zachtaardig.");
    expect(result.birthStory).toBe("Nova ontwaakte uit een ochtendnevel over stil water.");
    expect(result.evolvedCharacter).toBe("");
    expect(result.bornAt).toEqual(bornAt);
    expect(result.seed).toBe("ochtendnevel over een stil water"); // random 0 → eerste Seed uit seeds.txt
    expect(JSON.stringify(heavy.doGenerateCalls[0]?.prompt)).toContain(result.seed);

    const rows = await db.select().from(dynimos);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Nova");
    expect(rows[0]?.seed).toBe(result.seed);
  });

  it("laadt bij de tweede boot() hetzelfde wezen zonder Type2-call, ook vanuit een nieuwe brain-instantie", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const firstHeavy = genesisModel({
      name: "Nova",
      coreCharacter: "Nieuwsgierig en zachtaardig.",
      birthStory: "Nova ontwaakte uit een ochtendnevel over stil water.",
    });
    const firstBrain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: firstHeavy },
      now: () => bornAt,
      random: () => 0,
    });
    const first = await firstBrain.boot();

    const secondHeavy = unusedModel();
    const secondBrain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: secondHeavy },
      now: () => bornAt,
      random: () => 0,
    });
    const second = await secondBrain.boot();

    expect(second).toEqual(first);
    expect(secondHeavy.doGenerateCalls).toHaveLength(0);
    expect(secondHeavy.doStreamCalls).toHaveLength(0);
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
    await brain.boot();

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
    await brainWithLight.boot();
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
    await brain.boot();

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
    await brain.boot();
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
    await brain.boot();
    await expect(collectText(brain.hear("Mislukt"))).rejects.toThrow();
    await collectText(brain.hear("Tweede poging"));

    const userTexts = contentsByRole(light.doStreamCalls[1]?.prompt, "user");
    expect(userTexts.some((c) => c.includes("Mislukt"))).toBe(false);
  });

  it("levert een emotion-event met de Type1-emotie en -intensiteit, vóór de eerste tekst", async () => {
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
    await brain.boot();

    const events: BrainEvent[] = [];
    for await (const event of brain.hear("Hoi!")) events.push(event);

    expect(events[0]).toEqual({ type: "emotion", emotion: "blij", intensity: 0.8 });
    const emotionIndex = events.findIndex((e) => e.type === "emotion");
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
    await genesisBrain.boot();

    const heavy = textModel(["Zwaar antwoord."]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model({ intent: "complex" }),
      type2: { light: unusedModel(), heavy },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.boot();
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
    await genesisBrain.boot();

    const light = textModel(["Hoi!"]);
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model({ intent: "simpel" }),
      type2: { light, heavy: unusedModel() },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.boot();
    const text = await collectText(brain.hear("Hoi!"));

    expect(text).toBe("Hoi!");
    expect(light.doStreamCalls).toHaveLength(1);
  });

  it("bewaart de laatst gekende emotie en intensiteit op de identity-rij", async () => {
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
    await brain.boot();
    await collectText(brain.hear("Vertel eens iets nieuws."));

    const rows = await db.select().from(dynimos);
    expect(rows[0]?.lastEmotion).toBe("nieuwsgierig");
    expect(rows[0]?.lastIntensity).toBeCloseTo(0.65);
  });

  it("geeft de uiting als state aan Type1 mee", async () => {
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
    await brain.boot();
    await collectText(brain.hear("Wat een mooie dag!"));

    expect(type1.doEvaluateCalls).toHaveLength(1);
    expect((type1.doEvaluateCalls[0] as { state: unknown }).state).toBe("Wat een mooie dag!");
  });

  it("antwoordt toch via het lichte model met een neutrale emotie als Type1 faalt", async () => {
    const bornAt = new Date("2026-01-01T00:00:00.000Z");
    const light = textModel(["Hoi."]);
    const brokenType1 = new Experimental_EvaluationMockModelV4({
      doEvaluate: async () => {
        throw new Error("Jev plat");
      },
    });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: brokenType1,
      type2: { light, heavy: genesisModel({ name: "Nova", coreCharacter: "x", birthStory: "y" }) },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.boot();

    const events: BrainEvent[] = [];
    for await (const event of brain.hear("Hoi!")) events.push(event);

    expect(events[0]).toEqual({ type: "emotion", emotion: "neutraal", intensity: 0 });
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
    await brain.boot();
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
    await firstSession.boot();
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
    await secondSession.boot();
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
    await brain.boot();

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
    await brain.boot();
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
    await brain.boot();

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
    await brain.boot();
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
    await brain.boot();
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
    await brain.boot();

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
    await brain.boot();
    await collectText(brain.hear("Welke dag is het?"));

    expect(await db.select().from(memories)).toHaveLength(0);
  });

  it("doet niets bij delete() zonder de juiste naam als bevestiging", async () => {
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
    await brain.boot();
    await collectText(brain.hear("Mijn kat heet Mimi."));

    expect(await brain.delete("Nora")).toBeNull();

    expect(await db.select().from(dynimos)).toHaveLength(1);
    expect(await db.select().from(memories)).toHaveLength(1);
    expect(heavy.doGenerateCalls).toHaveLength(1); // enkel de genesis
  });

  it("schrijft bij delete() met de juiste naam een Grafschrift en wist identiteit en herinneringen", async () => {
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
    await brain.boot();
    await collectText(brain.hear("Mijn kat heet Mimi."));
    clock = deletedAt;

    const returned = await brain.delete("Nova");

    const [epitaph, ...rest] = await db.select().from(epitaphs);
    expect(rest).toHaveLength(0);
    expect(returned).toEqual(epitaph);
    expect(epitaph).toMatchObject({ name: "Nova", bornAt, deletedAt, farewellReflection: "Dank je voor elk gesprek." });
    expect(heavy.doGenerateCalls).toHaveLength(2); // genesis + aparte Afscheidsreflectie
    expect(JSON.stringify(heavy.doGenerateCalls[1]?.prompt)).toContain("Nova");
    expect(await db.select().from(dynimos)).toHaveLength(0);
    expect(await db.select().from(memories)).toHaveLength(0);
  });

  it("wist bij delete() enkel de herinneringen van het verwijderde wezen, niet die van andere Dynimo's", async () => {
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
    await brain.boot();
    await collectText(brain.hear("Mijn kat heet Mimi."));

    const [other] = await db
      .insert(dynimos)
      .values({ name: "Vero", coreCharacter: "x", birthStory: "y", seed: "z", bornAt })
      .returning({ id: dynimos.id });
    await db
      .insert(memories)
      .values({ dynimoId: other!.id, text: "Herinnering van Vero.", embedding: fakeVector(""), createdAt: bornAt });

    await brain.delete("Nova");

    const otherMemories = await db.select().from(memories).where(eq(memories.dynimoId, other!.id));
    expect(otherMemories).toHaveLength(1);
    expect(otherMemories[0]?.text).toBe("Herinnering van Vero.");
  });

  it("laat na delete() een volledig nieuw wezen geboren worden dat niets van het Grafschrift ziet", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const heavy = new MockLanguageModelV4({
      doGenerate: [
        generateResult(JSON.stringify({ name: "Nova", coreCharacter: "Speels.", birthStory: "Ochtendnevel." })),
        generateResult("Vaarwel, lieve Mimi-kenner."),
        generateResult(JSON.stringify({ name: "Lumen", coreCharacter: "Rustig.", birthStory: "Maanlicht." })),
      ],
    });
    const light = new MockLanguageModelV4({ doStream: [textStream("Hoi."), textStream("Hallo, ik ben Lumen.")] });
    const brain = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light, heavy },
      now: () => bornAt,
      random: () => 0,
    });
    await brain.boot();
    await collectText(brain.hear("Mijn kat heet Mimi."));
    await brain.delete("Nova");

    const reborn = await brain.boot();
    await collectText(brain.hear("Wie ben jij?"));

    expect(reborn.name).toBe("Lumen");
    expect(heavy.doGenerateCalls).toHaveLength(3); // genesis, afscheid, nieuwe genesis
    const inputsAfterDeletion = JSON.stringify([heavy.doGenerateCalls[2]?.prompt, light.doStreamCalls[1]?.prompt]);
    expect(inputsAfterDeletion).not.toContain("Nova");
    expect(inputsAfterDeletion).not.toContain("Vaarwel");
    expect(inputsAfterDeletion).not.toContain("Mimi");
  });

  it("maakt maar één Grafschrift als twee instanties hetzelfde wezen verwijderen", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const first = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: lifecycleModel("Nova", "Vaarwel.") },
      now: () => bornAt,
      random: () => 0,
    });
    await first.boot();
    const second = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: new MockLanguageModelV4({ doGenerate: [generateResult("Ook vaarwel.")] }) },
      now: () => bornAt,
      random: () => 0,
    });
    await second.boot();

    expect(await first.delete("Nova")).not.toBeNull();
    expect(await second.delete("Nova")).toBeNull();
    expect(await db.select().from(epitaphs)).toHaveLength(1);
  });

  it("weigert hear() in een instantie waarvan het wezen intussen verwijderd is", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const deleter = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: lifecycleModel("Nova", "Vaarwel.") },
      now: () => bornAt,
      random: () => 0,
    });
    await deleter.boot();
    const stale = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: textModel(["Hoi."]), heavy: unusedModel() },
      now: () => bornAt,
      random: () => 0,
    });
    await stale.boot();
    await deleter.delete("Nova");

    await expect(collectText(stale.hear("Mijn kat heet Mimi."))).rejects.toThrow(/verwijderd/);
    expect(await db.select().from(memories)).toHaveLength(0);
  });

  it("vergeet in een verouderde instantie ook het werkgeheugen, zodat een nieuw wezen er niets van ziet", async () => {
    const bornAt = new Date("2026-01-01T12:00:00.000Z");
    const deleter = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: { light: unusedModel(), heavy: lifecycleModel("Nova", "Vaarwel.") },
      now: () => bornAt,
      random: () => 0,
    });
    await deleter.boot();
    const light = new MockLanguageModelV4({ doStream: [textStream("Leuke kat."), textStream("Hoi, ik ben Lumen.")] });
    const stale = createBrain({
      db,
      embedder: embedModel(),
      type1: type1Model(),
      type2: {
        light,
        heavy: new MockLanguageModelV4({
          doGenerate: [generateResult(JSON.stringify({ name: "Lumen", coreCharacter: "Rustig.", birthStory: "Maanlicht." }))],
        }),
      },
      now: () => bornAt,
      random: () => 0,
    });
    await stale.boot();
    await collectText(stale.hear("Mijn kat heet Mimi."));
    await deleter.delete("Nova");
    await expect(collectText(stale.hear("Ben je er nog?"))).rejects.toThrow(/verwijderd/);

    await stale.boot();
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
    await brain.boot();

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
});

