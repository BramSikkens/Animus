import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { eq, isNull } from "drizzle-orm";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { createDb, migrate } from "@animus/db";
import { EMBEDDING_DIMENSIONS, dynimos, familiarities, memories, persons } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { singleEmotionValues } from "../src/mood.js";
import { createBrain } from "../src/index.js";
import type { Gesprekspartner } from "../src/perception.js";
import { createTestDb, databaseUrl, truncateAll } from "./db.js";

const DRIZZLE_DIR = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const ZERO_VECTOR = `[${new Array<number>(EMBEDDING_DIMENSIONS).fill(0).join(",")}]`;

// Migreert een verse database tot en met de migratie vóór "personen" (de laatste journal-entry eraf), zodat we
// bestaande data kunnen invoegen zoals die er vóór #91 uitzag, en dan pas de personen-migratie laten draaien.
async function migrateUpToPersonen(client: ReturnType<typeof postgres>): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "animus-drizzle-"));
  fs.cpSync(DRIZZLE_DIR, tmpDir, { recursive: true });
  const journalPath = path.join(tmpDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const personenIdx = journal.entries.findIndex((entry) => entry.tag.includes("personen"));
  journal.entries = journal.entries.slice(0, personenIdx);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  const { drizzle } = await import("drizzle-orm/postgres-js");
  await drizzleMigrate(drizzle(client), { migrationsFolder: tmpDir });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe("Migratie: personen (#91)", () => {
  it("geeft bestaande Herinneringen en Vertrouwdheid aan de eigenaar", async () => {
    const dbName = `animus_test_migratie_personen_${Date.now()}`;
    const admin = postgres(databaseUrl("postgres"), { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
    } finally {
      await admin.end();
    }

    const client = postgres(databaseUrl(dbName), { onnotice: () => {} });
    try {
      await migrateUpToPersonen(client);

      // Data zoals die er vóór #91 uitzag: raw SQL, want dynimos.familiarity bestaat niet meer in het TS-schema.
      const [{ id: dynimoId }] = await client`
        insert into dynimos (name, core_character, birth_story, seed, born_at, familiarity)
        values ('Vero', 'Rustig.', 'Geboren.', 'z', now(), 0.7)
        returning id
      `;
      await client`
        insert into memories (dynimo_id, text, embedding, created_at)
        values (${dynimoId}, 'Hallo', ${ZERO_VECTOR}, now())
      `;

      const db = createDb(databaseUrl(dbName));
      try {
        await migrate(db);

        const owner = (await db.select().from(persons))[0]!;
        expect(owner.name).toBe("eigenaar");
        expect(owner.owner).toBe(true);

        const memory = (await db.select().from(memories).where(eq(memories.dynimoId, dynimoId)))[0]!;
        expect(memory.personId).toBe(owner.id);
        expect((await db.select().from(memories).where(isNull(memories.personId))).length).toBe(0);

        const familiarity = (await db.select().from(familiarities).where(eq(familiarities.dynimoId, dynimoId)))[0]!;
        expect(familiarity.personId).toBe(owner.id);
        expect(familiarity.familiarity).toBeCloseTo(0.7, 5);
      } finally {
        await db.$client.end();
      }
    } finally {
      await client.end();
      const admin2 = postgres(databaseUrl("postgres"), { max: 1, onnotice: () => {} });
      await admin2.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin2.end();
    }
  }, 30_000);
});

describe("Personen in hear() (#91)", () => {
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
  const TOOL_CALLS: { unified: "tool-calls"; raw: undefined } = { unified: "tool-calls", raw: undefined };

  // Een model dat eerst de remember-tool aanroept, en daarna pas met tekst antwoordt.
  function toolThenTextModel(input: object, answer: string) {
    return new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "tool-call" as const, toolCallId: "call-1", toolName: "remember", input: JSON.stringify(input) },
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

  // Eén Type1 voor de classificatie in hear(); blijScore configureerbaar voor de "positief"-drempel.
  const type1 = (blijScore = 4) =>
    new Experimental_EvaluationMockModelV4({
      doEvaluate: async (options) => {
        const questions = Object.keys((options as { questions: Record<string, unknown> }).questions);
        const known: Record<string, { type: "choice"; choice: string } | { type: "score"; score: number }> = {
          ...Object.fromEntries(EMOTIONS.map((emotion) => [`delta_${emotion}`, { type: "score" as const, score: 4 }])),
          ...{ delta_blij: { type: "score" as const, score: blijScore } },
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

  const brainWith = (model: MockLanguageModelV4, blijScore = 4, rng = 0.99) =>
    createBrain({ db, embedder: embedder(), type1: type1(blijScore), type2: { light: model, heavy: model }, now: () => now, random: () => rng });

  async function hear(brain: ReturnType<typeof createBrain>, text: string, options?: { initiatief?: boolean; gesprekspartner?: Gesprekspartner }) {
    for await (const _ of brain.hear(text, options)) void _;
  }

  it("een nieuwe Dynimo heeft Vertrouwdheid 0.2 voor een willekeurige Persoon", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const brain = brainWith(type2().model);
    expect(await brain.familiarityOf(vero.id, anna.id)).toBe(0.2);
  });

  it("familiarityOf zonder personId leest de eigenaar enkel, maakt hem nooit aan (#111)", async () => {
    const vero = await insertDynimo();
    const brain = brainWith(type2().model);

    expect(await brain.familiarityOf(vero.id)).toBe(0.2);

    expect(await db.select().from(persons)).toHaveLength(0);
  });

  it("personName geeft de naam van personId in één lichte query (#111)", async () => {
    const anna = await insertPerson("Anna");
    const brain = brainWith(type2().model);
    expect(await brain.personName(anna.id)).toBe("Anna");
  });

  it("personName valt zonder personId terug op de eigenaar, zonder die aan te maken (#111)", async () => {
    const brain = brainWith(type2().model);

    expect(await brain.personName()).toBeNull();

    expect(await db.select().from(persons)).toHaveLength(0);
  });

  it("personName geeft de eigenaar-naam als die al bestaat (#111)", async () => {
    await db.insert(persons).values({ name: "eigenaar", owner: true });
    const brain = brainWith(type2().model);

    expect(await brain.personName()).toBe("eigenaar");
  });

  it("hear met een Persoon: de Herinnering heeft die person_id; Vertrouwdheid groeit voor die Persoon, niet voor de eigenaar", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const brain = brainWith(type2().model);

    await hear(brain, "Hoi", { gesprekspartner: { soort: "persoon", personId: anna.id } });

    await brain.settled();
    const [memory] = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(memory!.personId).toBe(anna.id);
    expect(await brain.familiarityOf(vero.id, anna.id)).toBeGreaterThan(0.2);
    expect(await brain.familiarityOf(vero.id)).toBe(0.2); // eigenaar (default) blijft ongemoeid
  });

  it("hear met onbekend (null): geen person_id op de Herinnering, geen familiarities-rij, afstandelijke toon", async () => {
    const vero = await insertDynimo();
    const t2 = type2();
    const brain = brainWith(t2.model);

    await hear(brain, "Hoi", { gesprekspartner: { soort: "onbekend" } });

    await brain.settled();
    const [memory] = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(memory!.personId).toBeNull();
    expect(await db.select().from(familiarities)).toHaveLength(0);
    expect(t2.prompts[0]).toContain("geen bijnamen"); // afstandelijke band bij 0.2
  });

  it("een genegeerde beurt verlaagt enkel de Vertrouwdheid van de Gesprekspartner van die beurt", async () => {
    const vero = await insertDynimo({ axisTf: 0, axisReactivity: 1, moodValues: singleEmotionValues("boos", 0.9), moodAt: now });
    const anna = await insertPerson("Anna");
    const brain = brainWith(type2().model, 4, 0);
    await brain.setFamiliarity(vero.id, 0.5); // eigenaar; setFamiliarity werkt enkel op de eigenaar
    await db.insert(familiarities).values({ dynimoId: vero.id, personId: anna.id, familiarity: 0.5 });

    await hear(brain, "Hallo daar", { gesprekspartner: { soort: "persoon", personId: anna.id } });

    expect(await brain.familiarityOf(vero.id, anna.id)).toBeLessThan(0.5);
    expect(await brain.familiarityOf(vero.id)).toBe(0.5); // eigenaar onaangeroerd
  });

  it("de remember-tool geeft de nieuwe Herinnering de Gesprekspartner van zijn eigen beurt", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const light = toolThenTextModel({ text: "Anna houdt van thee." }, "Onthouden!");
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light, heavy: light }, now: () => now, random: () => 0.99 });

    await hear(brain, "Onthoud dat ik van thee houd", { gesprekspartner: { soort: "persoon", personId: anna.id } });

    await brain.settled();
    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    const remembered = rows.find((row) => row.text === "Anna houdt van thee.");
    expect(remembered?.personId).toBe(anna.id);
  });

  it("hear met een onbestaand Persoon-id geeft wél een antwoord; Vertrouwdheid wordt niet geschreven", async () => {
    const vero = await insertDynimo();
    const brain = brainWith(type2().model);

    const events: string[] = [];
    for await (const event of brain.hear("Hoi", { gesprekspartner: { soort: "persoon", personId: 999_999 } })) {
      if (event.type === "text") events.push(event.delta);
    }

    expect(events.join("")).toContain("Hoi!");
    expect(await db.select().from(familiarities)).toHaveLength(0);
  });

  it("hear met een intussen verwijderde Persoon: de Herinnering wordt opgeslagen zonder Persoon i.p.v. te verdwijnen (#107)", async () => {
    const vero = await insertDynimo();
    const brain = brainWith(type2().model);

    await hear(brain, "Hoi", { gesprekspartner: { soort: "persoon", personId: 999_999 } });

    await brain.settled();
    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBeNull();
  });

  it("zonder Gesprekspartner gedraagt alles zich als nu (eigenaar)", async () => {
    const vero = await insertDynimo();
    const brain = brainWith(type2().model);

    await hear(brain, "Hoi");

    await brain.settled();
    const [memory] = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    const owner = (await db.select().from(persons).where(eq(persons.owner, true)))[0]!;
    expect(memory!.personId).toBe(owner.id);
    expect(await brain.familiarityOf(vero.id)).toBeGreaterThan(0.2);
  });

  it("setFamiliarity/familiarityOf werken op de eigenaar; false bij een onbekende Dynimo", async () => {
    const vero = await insertDynimo();
    const brain = brainWith(type2().model);
    expect(await brain.setFamiliarity(vero.id, 0.77)).toBe(true);
    expect(await brain.familiarityOf(vero.id)).toBe(0.77);
    expect(await brain.setFamiliarity(vero.id + 999, 0.5)).toBe(false);
  });

  it("Reflectie na lange stilte verlaagt de Vertrouwdheid van elke Persoon met een rij", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const reflectionResult = {
      evolvedCharacter: "Rustig.",
      axisShifts: { ie: 0, sn: 0, tf: 0, jp: 0, reactivity: 0, expressiveness: 0 },
      verstandShift: 0,
      drives: { add: [], closeGoals: [], drop: [] },
      wakeMood: { emotion: "kalm", intensity: 0.4 },
      dream: null,
    };
    const heavy = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: JSON.stringify(reflectionResult) }],
        finishReason: STOP,
        usage: NULL_USAGE,
        warnings: [],
      }),
    });
    const brain = createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: type2().model, heavy }, now: () => now, random: () => 0.99 });
    await brain.setFamiliarity(vero.id, 0.5);
    await hear(brain, "Hoi", { gesprekspartner: { soort: "persoon", personId: anna.id } });
    const annaBefore = await brain.familiarityOf(vero.id, anna.id);

    await brain.reflect();

    expect(await brain.familiarityOf(vero.id)).toBeLessThan(0.5);
    expect(await brain.familiarityOf(vero.id, anna.id)).toBeLessThan(annaBefore);
  });
});
