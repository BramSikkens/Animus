import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { EMBEDDING_DIMENSIONS, drives, dynimos, memories } from "@animus/db/schema";
import { eq } from "drizzle-orm";
import { createBrain, REMOTE_REFLECTION_TTL_MS, type BrainEvent } from "../src/index.js";
import { singleEmotionValues } from "../src/mood.js";
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

function embedModel() {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0).map((_, i) => (i === 0 ? 1 : 0))),
      warnings: [],
    }),
  });
}

/** Type1 voor de initiatief-check: registreert de aanroepen; `spreken` en `onderwerp` instelbaar. */
function initiativeType1(answer: { spreken: "ja" | "nee"; onderwerp?: string } | Error) {
  const calls: { state: string; questions: Record<string, unknown> }[] = [];
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      const o = options as { state: unknown; questions: Record<string, unknown> };
      calls.push({ state: String(o.state), questions: o.questions });
      if (answer instanceof Error) throw answer;
      return {
        answers: {
          spreken: { type: "choice", choice: answer.spreken },
          onderwerp: { type: "choice", choice: answer.onderwerp ?? "vrij" },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

function brainWith(type1: Experimental_EvaluationMockModelV4, heavy = unusedModel(), light = unusedModel()) {
  return createBrain({ db, embedder: embedModel(), type1, type2: { light, heavy }, now: () => bornAt, random: () => 0 });
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
      axisIe: 0.5,
      axisSn: 0.8,
      axisTf: 0.5,
      axisJp: 0.8,
      ...extra,
    })
    .returning();
  return row!;
}

describe("considerInitiative()", () => {
  it("geeft niets en roept Type1 niet aan als niemand wakker is", async () => {
    await insertDynimo({ awakeSince: null });
    const type1 = initiativeType1({ spreken: "ja" });

    expect(await brainWith(type1.model).considerInitiative()).toBeNull();
    expect(type1.calls).toHaveLength(0);
  });
});

describe("considerInitiative(): Type1-check", () => {
  it("geeft een instructie als Type1 wil spreken, met Persoonlijkheid, Drijfveren en Stemming als context", async () => {
    const dynimo = await insertDynimo({ moodValues: singleEmotionValues("blij", 0.9), moodAt: bornAt });
    await db.insert(drives).values({ dynimoId: dynimo.id, kind: "doel", text: "Leer de zee tekenen", status: "actief", createdAt: bornAt, updatedAt: bornAt });
    const type1 = initiativeType1({ spreken: "ja" });

    const result = await brainWith(type1.model).considerInitiative();

    expect(result).toEqual(expect.any(String));
    expect(result!.length).toBeGreaterThan(0);
    expect(type1.calls).toHaveLength(1);
    expect(type1.calls[0]!.state).toContain("Persoonlijkheid: ");
    expect(type1.calls[0]!.state).toContain("Leer de zee tekenen");
    expect(type1.calls[0]!.state).toContain("blij");
  });

  it("geeft niets als Type1 niet wil spreken", async () => {
    await insertDynimo();
    expect(await brainWith(initiativeType1({ spreken: "nee" }).model).considerInitiative()).toBeNull();
  });
});

describe("considerInitiative(aanleiding)", () => {
  it("zet de aanleiding 'terug' in de Type1-state", async () => {
    await insertDynimo();
    const type1 = initiativeType1({ spreken: "nee" });

    await brainWith(type1.model).considerInitiative({ soort: "terug" });

    expect(type1.calls[0]!.state).toContain("Aanleiding: de Gesprekspartner is net terug in beeld na een tijd weg te zijn geweest.");
  });

  it("zet de aanleiding 'nieuw-object' in de Type1-state", async () => {
    await insertDynimo();
    const type1 = initiativeType1({ spreken: "nee" });

    await brainWith(type1.model).considerInitiative({ soort: "nieuw-object", object: "cat" });

    expect(type1.calls[0]!.state).toContain("Aanleiding: er verscheen net iets nieuws in beeld: cat.");
  });

  it("zet de aanleiding 'terug' in de instructie bij ja", async () => {
    const dynimo = await insertDynimo();
    const type1 = initiativeType1({ spreken: "ja" });

    const result = await brainWith(type1.model).considerInitiative({ soort: "terug" });

    expect(result).toContain("terug in beeld");
  });

  it("geeft null bij nee, ook met aanleiding", async () => {
    await insertDynimo();
    const type1 = initiativeType1({ spreken: "nee" });

    expect(await brainWith(type1.model).considerInitiative({ soort: "terug" })).toBeNull();
  });

  it("kiest bij een aanleiding geen Spontane herinnering of Droom", async () => {
    const dynimo = await insertDynimo();
    await db.insert(memories).values({
      dynimoId: dynimo.id,
      text: "Iets vormends van lang geleden.",
      embedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0),
      createdAt: new Date(bornAt.getTime() - 10 * 24 * 60 * 60 * 1000),
      impression: 1,
    });
    const type1 = initiativeType1({ spreken: "ja" });

    const result = await brainWith(type1.model).considerInitiative({ soort: "terug" });

    expect(result).not.toContain("Iets vormends van lang geleden.");
    expect(result).toContain("terug in beeld");
  });
});

describe("considerInitiative(): Reflectie", () => {
  it("geeft niets zolang er een Reflectie loopt en werkt daarna weer", async () => {
    const dynimo = await insertDynimo();
    await db.insert(memories).values({
      dynimoId: dynimo.id,
      text: "Een gesprek.",
      embedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0),
      createdAt: bornAt,
      impression: 0.5,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const heavy = new MockLanguageModelV4({
      doGenerate: async () => {
        await gate;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                evolvedCharacter: "Iets gegroeid.",
                axisShifts: { ie: 0, sn: 0, tf: 0, jp: 0, reactivity: 0, expressiveness: 0 },
                verstandShift: 0,
                drives: { add: [], closeGoals: [], adjust: [], drop: [] },
                wakeMood: { emotion: "kalm", intensity: 0.3 },
                dream: null,
              }),
            },
          ],
          finishReason: STOP,
          usage: NULL_USAGE,
          warnings: [],
        };
      },
    });
    const type1 = initiativeType1({ spreken: "ja" });
    const brain = brainWith(type1.model, heavy);

    const reflecting = brain.reflect();
    await new Promise((resolve) => setTimeout(resolve, 50)); // laat de Reflectie de Type2-call bereiken

    expect(await brain.considerInitiative()).toBeNull();
    expect(type1.calls).toHaveLength(0);

    release();
    expect(await reflecting).toBe(true);
    expect(await brain.considerInitiative()).not.toBeNull();
  });

  // #114: reflecting was instantiebreed, dus de Reflectie van de ene Dynimo blokkeerde het initiatief van een
  // andere. Moet per Dynimo (per id) zijn.
  it("de Reflectie van Dynimo A blokkeert het initiatief van Dynimo B niet", async () => {
    const dynimoA = await insertDynimo();
    await db.insert(memories).values({
      dynimoId: dynimoA.id,
      text: "Een gesprek.",
      embedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0),
      createdAt: bornAt,
      impression: 0.5,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const heavy = new MockLanguageModelV4({
      doGenerate: async () => {
        await gate;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                evolvedCharacter: "Iets gegroeid.",
                axisShifts: { ie: 0, sn: 0, tf: 0, jp: 0, reactivity: 0, expressiveness: 0 },
                verstandShift: 0,
                drives: { add: [], closeGoals: [], adjust: [], drop: [] },
                wakeMood: { emotion: "kalm", intensity: 0.3 },
                dream: null,
              }),
            },
          ],
          finishReason: STOP,
          usage: NULL_USAGE,
          warnings: [],
        };
      },
    });
    const type1 = initiativeType1({ spreken: "ja" });
    const brain = brainWith(type1.model, heavy);

    const reflecting = brain.reflect(); // reflecteert Dynimo A (blijft in-flight, gate dicht)
    await new Promise((resolve) => setTimeout(resolve, 50)); // laat de Reflectie de Type2-call bereiken

    // B wordt de wakkere Dynimo, los van A's nog lopende Reflectie.
    await db.update(dynimos).set({ awakeSince: null }).where(eq(dynimos.id, dynimoA.id));
    await insertDynimo({ name: "Wies", awakeSince: new Date(bornAt.getTime() + 1000) });

    expect(await brain.considerInitiative()).not.toBeNull();
    expect(type1.calls).toHaveLength(1);

    release();
    expect(await reflecting).toBe(true);
  });
});

describe("noteReflection() (#125): initiatief-blokkade van buitenaf melden, bv. door de worker)", () => {
  it("blokkeert het initiatief van Dynimo A en heft de blokkade na noteReflection(A, false) weer op", async () => {
    const dynimoA = await insertDynimo();
    const type1 = initiativeType1({ spreken: "ja" });
    const brain = brainWith(type1.model);

    brain.noteReflection(dynimoA.id, true);
    expect(await brain.considerInitiative()).toBeNull();

    brain.noteReflection(dynimoA.id, false);
    expect(await brain.considerInitiative()).not.toBeNull();
  });

  it("blokkeert het initiatief van Dynimo B niet als enkel A genoteerd is", async () => {
    const dynimoA = await insertDynimo({ awakeSince: null }); // A: slaapt, enkel om zijn id te reserveren
    const dynimoB = await insertDynimo({ name: "Wies", awakeSince: new Date(bornAt.getTime() + 1000) });
    const type1 = initiativeType1({ spreken: "ja" });
    const brain = brainWith(type1.model);

    brain.noteReflection(dynimoA.id, true);

    expect(await brain.considerInitiative()).not.toBeNull(); // B is wakker, A's blokkade raakt B niet
  });

  it("één einde heft de blokkade op, ook na een dubbele start (herstarte job na een worker-crash)", async () => {
    const dynimoA = await insertDynimo();
    const brain = brainWith(initiativeType1({ spreken: "ja" }).model);

    brain.noteReflection(dynimoA.id, true);
    brain.noteReflection(dynimoA.id, true);
    brain.noteReflection(dynimoA.id, false);

    expect(await brain.considerInitiative()).not.toBeNull();
  });

  it("een start zonder einde (worker gecrasht, melding gemist) blokkeert niet langer dan REMOTE_REFLECTION_TTL_MS", async () => {
    const dynimoA = await insertDynimo();
    let at = bornAt.getTime();
    const brain = createBrain({ db, embedder: embedModel(), type1: initiativeType1({ spreken: "ja" }).model, type2: { light: unusedModel(), heavy: unusedModel() }, now: () => new Date(at), random: () => 0 });

    brain.noteReflection(dynimoA.id, true);
    at += REMOTE_REFLECTION_TTL_MS - 1;
    expect(await brain.considerInitiative()).toBeNull();

    at += 2;
    expect(await brain.considerInitiative()).not.toBeNull();
  });
});

describe("considerInitiative(): Doelen en robuustheid", () => {
  it("gooit nooit: een falende Type1 geeft null", async () => {
    await insertDynimo();
    const type1 = initiativeType1(new Error("Type1 is stuk"));
    expect(await brainWith(type1.model).considerInitiative()).toBeNull();
  });

  it("laat de instructie over een actief Doel gaan als Type1 dat onderwerp kiest", async () => {
    const dynimo = await insertDynimo();
    await db.insert(drives).values({ dynimoId: dynimo.id, kind: "doel", text: "Leer de zee tekenen", status: "actief", createdAt: bornAt, updatedAt: bornAt });
    const type1 = initiativeType1({ spreken: "ja", onderwerp: "doel" });

    const result = await brainWith(type1.model).considerInitiative();

    expect(result).toContain("Doel");
    expect((type1.calls[0]!.questions.onderwerp as { criteria: Record<string, unknown> }).criteria).toHaveProperty("doel");
  });

  it("biedt het Doel-onderwerp niet aan zonder actief Doel", async () => {
    const dynimo = await insertDynimo();
    await db.insert(drives).values({ dynimoId: dynimo.id, kind: "doel", text: "Bereikt streven", status: "bereikt", createdAt: bornAt, updatedAt: bornAt });
    const type1 = initiativeType1({ spreken: "ja" });

    const result = await brainWith(type1.model).considerInitiative();

    expect((type1.calls[0]!.questions.onderwerp as { criteria: Record<string, unknown> }).criteria).not.toHaveProperty("doel");
    expect(result).not.toContain("Doel");
  });

  it("verandert nooit de status van een Doel", async () => {
    const dynimo = await insertDynimo();
    await db.insert(drives).values({ dynimoId: dynimo.id, kind: "doel", text: "Leer de zee tekenen", status: "actief", createdAt: bornAt, updatedAt: bornAt });

    await brainWith(initiativeType1({ spreken: "ja", onderwerp: "doel" }).model).considerInitiative();

    const [goal] = await db.select().from(drives).where(eq(drives.dynimoId, dynimo.id));
    expect(goal).toMatchObject({ status: "actief", droppedAt: null });
  });
});

describe("hear(..., { initiatief: true })", () => {
  function textStreamModel(text: string) {
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

  async function collect(events: AsyncIterable<BrainEvent>): Promise<BrainEvent[]> {
    const all: BrainEvent[] = [];
    for await (const event of events) all.push(event);
    return all;
  }

  it("spreekt zonder Type1-classificatie, laat de Stemming ongemoeid en bewaart geen Gesprekspartner-regel", async () => {
    const dynimo = await insertDynimo({ moodValues: singleEmotionValues("blij", 0.9), moodAt: bornAt });
    const type1 = initiativeType1({ spreken: "ja" });
    const light = textStreamModel("Zeg, ik dacht net aan de zee.");
    const brain = brainWith(type1.model, unusedModel(), light);

    const events = await collect(brain.hear("Je begint uit jezelf een gesprek.", { initiatief: true }));

    expect(type1.calls).toHaveLength(0);
    expect(events.filter((event) => event.type === "text").map((event) => (event as { delta: string }).delta).join("")).toContain(
      "Zeg, ik dacht net aan de zee.", // een Spraakgeluid ervoor is toegestaan
    );
    expect(events[0]).toMatchObject({ type: "mood", emotion: "blij" });
    const [row] = await db.select().from(dynimos).where(eq(dynimos.id, dynimo.id));
    expect(row).toMatchObject({ moodValues: { blij: 95 } });
    await brain.settled();
    const stored = await db.select().from(memories);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toBe("Vero: Zeg, ik dacht net aan de zee.");
  });
});
