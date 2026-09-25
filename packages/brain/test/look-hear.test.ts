import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { eq } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, dynimos, memories } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain, type Frame } from "../src/index.js";
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

// Legt het RAW prompt-object vast dat Type2 krijgt.
function type2() {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt);
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

async function hear(brain: ReturnType<typeof createBrain>, text: string): Promise<void> {
  for await (const _ of brain.hear(text)) void _;
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

    const stored = await db.select({ text: memories.text }).from(memories).where(eq(memories.dynimoId, row.id));
    for (const memory of stored) expect(typeof memory.text).toBe("string");
    expect(stored.some((memory) => memory.text.includes("Wat zie je?"))).toBe(true);
  });
});
