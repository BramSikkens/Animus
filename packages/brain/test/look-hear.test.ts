import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { eq } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, dynimos, memories } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain, type BrainEvent, type Frame } from "../src/index.js";
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

const warnSpy = vi.spyOn(console, "warn");
afterEach(() => {
  // Geen enkele test mag stil op een falende Type1-classificatie terugvallen: dat zou een ander
  // gedrag (0 beelden) verklaren dan het gedrag dat de test denkt te testen.
  expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Type1 faalde"), expect.anything());
  warnSpy.mockClear();
});

const NULL_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const STOP: { unified: "stop"; raw: undefined } = { unified: "stop", raw: undefined };

const FRAME: Frame = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), mediaType: "image/jpeg" };

// Type1-mock: kijken/intent instelbaar via een muteerbaar object (nodig voor de meerdere-beurten-test), en legt de
// gevraagde vraag-keys vast.
function type1(state: { kijken?: "ja" | "nee"; intent?: "simpel" | "complex" } = {}) {
  const askedKeys: string[] = [];
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
      askedKeys.push(...questions);
      const known: Record<string, { type: "choice"; choice: string } | { type: "score"; score: number }> = {
        ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
        indruk: { type: "score", score: 0.2 },
        intent: { type: "choice", choice: state.intent ?? "simpel" },
        kijken: { type: "choice", choice: state.kijken ?? "nee" },
      };
      return { answers: Object.fromEntries(questions.map((key) => [key, known[key]!])), warnings: [] };
    },
  });
  return { model, askedKeys };
}

const embedder = () =>
  new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }),
  });

// Legt het RAW prompt-object én de aangeboden tools vast die Type2 per call krijgt. `steps` scriptet, per call,
// of Type2 de kijk-tool aanroept ("kijk") of tekst antwoordt ("text"); calls voorbij het script antwoorden tekst.
function type2(steps: ("kijk" | "text")[] = []) {
  const calls: { prompt: unknown; tools: unknown }[] = [];
  let callIndex = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push({ prompt: options.prompt, tools: options.tools });
      const step = steps[callIndex] ?? "text";
      callIndex++;
      if (step === "kijk") {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "tool-call" as const, toolCallId: `k${callIndex}`, toolName: "kijk", input: "{}" },
              { type: "finish" as const, usage: NULL_USAGE, finishReason: { unified: "tool-calls" as const, raw: undefined } },
            ],
          }),
        };
      }
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
  return { model, calls, get prompts(): unknown[] { return calls.map((c) => c.prompt); } };
}

async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5, ...extra })
    .returning();
  return row!;
}

async function hear(brain: ReturnType<typeof createBrain>, text: string): Promise<void> {
  for await (const _ of brain.hear(text)) void _;
}

async function hearInitiatief(brain: ReturnType<typeof createBrain>, text: string): Promise<void> {
  for await (const _ of brain.hear(text, { initiatief: true })) void _;
}

// Type1-mock voor considerInitiative (spreken/onderwerp), los van de classify-mock hierboven: hear(initiatief:true)
// roept classify() niet aan, dus dit is de enige vraag die dit model hoeft te beantwoorden.
function initiativeType1(spreken: "ja" | "nee") {
  return new Experimental_EvaluationMockModelV4({
    doEvaluate: async () => ({
      answers: { spreken: { type: "choice", choice: spreken }, onderwerp: { type: "choice", choice: "vrij" } },
      warnings: [],
    }),
  });
}

async function hearEvents(brain: ReturnType<typeof createBrain>, text: string): Promise<BrainEvent[]> {
  const events: BrainEvent[] = [];
  for await (const event of brain.hear(text)) events.push(event);
  return events;
}

// Telt afbeeldingen in de user-berichten van het RAW prompt-object: de AI SDK normaliseert een `image`-content-part
// naar een `file`-part in het prompt dat het model ziet.
function countImages(prompt: unknown): number {
  const messages = prompt as { role: string; content: unknown }[];
  return messages
    .filter((m) => m.role === "user")
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((part: { type?: string }) => part && (part.type === "file" || part.type === "image")).length;
}

// Diepe telling: loopt het hele prompt-object (ook tool-berichten) af en telt elk object met een `mediaType` die met
// "image/" begint. Nodig omdat een beeld in een tool-resultaat (kijk-tool) niet in een user-bericht zit.
function countAllImages(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const own = typeof record.mediaType === "string" && record.mediaType.startsWith("image/") ? 1 : 0;
  const children = Array.isArray(value) ? value : Object.values(record);
  return own + children.reduce((sum: number, child) => sum + countAllImages(child), 0);
}

describe("Kijken in hear()", () => {
  it("kijken=ja + lookFrame geeft een frame: Type2-prompt bevat precies 1 beeld", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja" });
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });
    await hear(brain, "Wat zie je?");
    expect(countImages(t2.prompts[0])).toBe(1);
  });

  it("kijken=nee: 0 beelden en lookFrame wordt niet aangeroepen", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "nee" });
    const t2 = type2();
    const lookFrame = vi.fn(async () => FRAME);
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame,
    });
    await hear(brain, "Hoi");
    expect(countImages(t2.prompts[0])).toBe(0);
    expect(lookFrame).not.toHaveBeenCalled();
  });

  it("kijken=ja + intent complex: het heavy-model krijgt het beeld, light niet", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja", intent: "complex" });
    const light = type2();
    const heavy = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: light.model, heavy: heavy.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });
    await hear(brain, "Leg dit eens uit wat je ziet");
    expect(light.prompts).toHaveLength(0);
    expect(countImages(heavy.prompts[0])).toBe(1);
  });

  it("kijken=ja + intent simpel: het light-model krijgt het beeld", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja", intent: "simpel" });
    const light = type2();
    const heavy = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: light.model, heavy: heavy.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });
    await hear(brain, "Wat zie je?");
    expect(heavy.prompts).toHaveLength(0);
    expect(countImages(light.prompts[0])).toBe(1);
  });

  it("kijken=ja + lookFrame geeft null: 0 beelden en de 'niets zien'-instructie", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja" });
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => null,
    });
    await hear(brain, "Wat zie je?");
    expect(countImages(t2.prompts[0])).toBe(0);
    expect(JSON.stringify(t2.prompts[0])).toContain("Je kunt nu niets zien");
  });

  it("kijken=ja + lookFrame rejectt: de beurt slaagt gewoon, 0 beelden", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja" });
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => {
        throw new Error("camera weg");
      },
    });
    await hear(brain, "Wat zie je?");
    expect(countImages(t2.prompts[0])).toBe(0);
    expect(JSON.stringify(t2.prompts[0])).toContain("Je kunt nu niets zien");
  });

  it("zonder lookFrame-dep: geen kijken-vraag aan Type1, 0 beelden, geen 'niets zien'-regel", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja" }); // zou 'ja' antwoorden als de vraag gesteld werd
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      // geen lookFrame
    });
    await hear(brain, "Wat zie je?");
    expect(t1.askedKeys).not.toContain("kijken");
    expect(countImages(t2.prompts[0])).toBe(0);
    expect(JSON.stringify(t2.prompts[0])).not.toContain("Je kunt nu niets zien");
  });

  it("na een kijk-beurt: de volgende beurt heeft geen beeld (Werkgeheugen) en de Herinnering is tekst", async () => {
    const row = await insertDynimo();
    const state: { kijken?: "ja" | "nee" } = { kijken: "ja" };
    const t1 = type1(state);
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });
    await hear(brain, "Wat zie je?");
    expect(countImages(t2.prompts[0])).toBe(1);

    state.kijken = "nee";
    await hear(brain, "Oke, dank je");
    expect(countImages(t2.prompts[1])).toBe(0);

    await brain.settled();
    const stored = await db.select({ text: memories.text }).from(memories).where(eq(memories.dynimoId, row.id));
    for (const memory of stored) expect(typeof memory.text).toBe("string");
    expect(stored.some((memory) => memory.text.includes("Wat zie je?"))).toBe(true);
  });
});

// Namen van de aangeboden tools op een gegeven call, ongeacht of `tools` ontbreekt.
function toolNames(call: { tools: unknown } | undefined): string[] {
  const tools = (call?.tools ?? []) as { name: string }[];
  return tools.map((t) => t.name);
}

function brainWith(config: { kijken?: "ja" | "nee"; steps?: ("kijk" | "text")[]; lookFrame?: (() => Promise<Frame | null>) | null } = {}) {
  const t1 = type1({ kijken: config.kijken });
  const t2 = type2(config.steps);
  const brain = createBrain({
    db,
    embedder: embedder(),
    type1: t1.model,
    type2: { light: t2.model, heavy: t2.model },
    now: () => now,
    random: () => 0.99,
    ...(config.lookFrame === null ? {} : { lookFrame: config.lookFrame ?? (async () => FRAME) }),
  });
  return { brain, t1, t2 };
}

describe("Kijk-tool in hear() (vangnet, ADR-0019)", () => {
  it("lookFrame aanwezig + kijken=nee: de kijk-tool wordt aangeboden", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "nee" });
    await hear(brain, "Hoi");
    expect(toolNames(t2.calls[0])).toContain("kijk");
  });

  it("kijken=ja (met frame): de kijk-tool wordt niet aangeboden", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "ja" });
    await hear(brain, "Wat zie je?");
    expect(toolNames(t2.calls[0])).not.toContain("kijk");
  });

  it("kijken=ja met een null-frame: de kijk-tool wordt niet aangeboden", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "ja", lookFrame: async () => null });
    await hear(brain, "Wat zie je?");
    expect(toolNames(t2.calls[0])).not.toContain("kijk");
  });

  it("zonder lookFrame-dep: de kijk-tool wordt niet aangeboden", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "nee", lookFrame: null });
    await hear(brain, "Wat zie je?");
    expect(toolNames(t2.calls[0])).not.toContain("kijk");
  });

  it("Type2 roept kijk aan, frame aanwezig: de tweede stap krijgt precies één beeld en het tool-result-event lekt geen bytes", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "nee", steps: ["kijk", "text"] });
    const events = await hearEvents(brain, "Kijk eens");
    expect(countAllImages(t2.calls[1]!.prompt)).toBe(1);
    const toolResult = events.find((event): event is Extract<BrainEvent, { type: "tool-result" }> => event.type === "tool-result" && event.toolName === "kijk");
    expect(toolResult?.output).toEqual({ gezien: true });
  });

  it("Type2 roept kijk aan, lookFrame geeft null: tool-resultaat is tekst, geen beeld", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "nee", steps: ["kijk", "text"], lookFrame: async () => null });
    await hear(brain, "Kijk eens");
    expect(countAllImages(t2.calls[1]!.prompt)).toBe(0);
    expect(JSON.stringify(t2.calls[1]!.prompt)).toContain("Je kunt nu niets zien");
  });

  it("Type2 roept kijk twee keer aan in één beurt: lookFrame wordt precies één keer aangeroepen", async () => {
    await insertDynimo();
    const lookFrame = vi.fn(async () => FRAME);
    const { brain, t2 } = brainWith({ kijken: "nee", steps: ["kijk", "kijk", "text"], lookFrame });
    await hear(brain, "Kijk nog eens");
    expect(lookFrame).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(t2.calls[2]!.prompt)).toContain("Je hebt deze beurt al gekeken");
  });

  it("na een beurt met kijk-tool: de volgende beurt heeft 0 beelden, wel het tool-resultaat als tekst", async () => {
    await insertDynimo();
    const { brain, t2 } = brainWith({ kijken: "nee", steps: ["kijk", "text", "text"] });
    await hear(brain, "Kijk eens");
    expect(countAllImages(t2.calls[1]!.prompt)).toBe(1);

    await hear(brain, "Oke, dank je");
    expect(countAllImages(t2.calls[2]!.prompt)).toBe(0);
    expect(JSON.stringify(t2.calls[2]!.prompt)).toContain("Dit zie je nu door je camera");
    expect(JSON.stringify(t2.calls[2]!.prompt)).toContain("(beeld niet bewaard)");
  });
});

function countKijkEvents(events: BrainEvent[]): number {
  return events.filter((event) => event.type === "kijk").length;
}

describe("kijk-event: er ging deze beurt echt een camerabeeld naar Type2", () => {
  it("kijken=ja + lookFrame geeft een frame: precies één kijk-event", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja" });
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });
    const events = await hearEvents(brain, "Wat zie je?");
    expect(countKijkEvents(events)).toBe(1);
  });

  it("kijken=ja + lookFrame geeft null: geen kijk-event", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "ja" });
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => null,
    });
    const events = await hearEvents(brain, "Wat zie je?");
    expect(countKijkEvents(events)).toBe(0);
  });

  it("kijken=nee: geen kijk-event", async () => {
    await insertDynimo();
    const t1 = type1({ kijken: "nee" });
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: t1.model,
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });
    const events = await hearEvents(brain, "Hoi");
    expect(countKijkEvents(events)).toBe(0);
  });

  it("kijk-tool met frame: precies één kijk-event", async () => {
    await insertDynimo();
    const { brain } = brainWith({ kijken: "nee", steps: ["kijk", "text"] });
    const events = await hearEvents(brain, "Kijk eens");
    expect(countKijkEvents(events)).toBe(1);
  });

  it("kijk-tool met null-frame: geen kijk-event", async () => {
    await insertDynimo();
    const { brain } = brainWith({ kijken: "nee", steps: ["kijk", "text"], lookFrame: async () => null });
    const events = await hearEvents(brain, "Kijk eens");
    expect(countKijkEvents(events)).toBe(0);
  });

  it("initiatief met pendingLook (nieuw-object + ja) en frame: precies één kijk-event", async () => {
    await insertDynimo();
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: initiativeType1("ja"),
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });

    const instructie = await brain.considerInitiative({ soort: "nieuw-object", object: "cat" });
    const events: BrainEvent[] = [];
    for await (const event of brain.hear(instructie!, { initiatief: true })) events.push(event);
    expect(countKijkEvents(events)).toBe(1);
  });
});

describe("Spontaan Kijken: considerInitiative(nieuw-object) wordt een Kijk-beurt in hear(initiatief) (#87)", () => {
  it("ja: de initiatiefbeurt bevat precies 1 beeld, de kijk-tool wordt niet aangeboden, en de instructie noemt het object", async () => {
    await insertDynimo();
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: initiativeType1("ja"),
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });

    const instructie = await brain.considerInitiative({ soort: "nieuw-object", object: "cat" });
    expect(instructie).toContain("cat");

    await hearInitiatief(brain, instructie!);
    expect(countImages(t2.prompts[0])).toBe(1);
    expect(toolNames(t2.calls[0])).not.toContain("kijk");
  });

  it("een volgende initiatiefbeurt heeft 0 beelden: de vlag is verbruikt", async () => {
    await insertDynimo();
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: initiativeType1("ja"),
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });

    const instructie = await brain.considerInitiative({ soort: "nieuw-object", object: "cat" });
    await hearInitiatief(brain, instructie!);
    await hearInitiatief(brain, "Je begint uit jezelf een gesprek.");
    expect(countImages(t2.prompts[1])).toBe(0);
  });

  it("nee: geen pending Kijk", async () => {
    await insertDynimo();
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: initiativeType1("nee"),
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });

    expect(await brain.considerInitiative({ soort: "nieuw-object", object: "cat" })).toBeNull();
    await hearInitiatief(brain, "Je begint uit jezelf een gesprek.");
    expect(countImages(t2.prompts[0])).toBe(0);
  });

  it("aanleiding 'terug' + ja: de initiatiefbeurt heeft geen beeld", async () => {
    await insertDynimo();
    const t2 = type2();
    const brain = createBrain({
      db,
      embedder: embedder(),
      type1: initiativeType1("ja"),
      type2: { light: t2.model, heavy: t2.model },
      now: () => now,
      random: () => 0.99,
      lookFrame: async () => FRAME,
    });

    const instructie = await brain.considerInitiative({ soort: "terug" });
    await hearInitiatief(brain, instructie!);
    expect(countImages(t2.prompts[0])).toBe(0);
  });
});
