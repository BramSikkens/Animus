// Personen-beheer voor het dashboard (#95, ADR-0020): hernoemen, samenvoegen, verwijderen, opnieuw leren.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { dynimos, EMBEDDING_DIMENSIONS, faceEmbeddings, familiarities, memories, persons, voiceProfiles } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain, STATE_CHANNEL } from "../src/index.js";
import { createTestDb, databaseUrl, TEST_DB_NAME, truncateAll } from "./db.js";

const db = createTestDb();
const bornAt = new Date("2026-01-01T12:00:00.000Z");
const now = new Date("2026-06-15T12:00:00.000Z");

// Zoals brain.test.ts "toestandsnotificaties": aparte connectie, want Postgres levert pas na commit.
async function listenState() {
  const client = postgres(databaseUrl(TEST_DB_NAME), { onnotice: () => {} });
  const received: string[] = [];
  await client.listen(STATE_CHANNEL, (payload) => received.push(payload));
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return received;
  };
  return { settle, close: () => client.end() };
}

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$client.end();
});

// Deze functies gebruiken geen Type1/Type2/embedder; de mocks hieronder worden nooit aangeroepen.
const embedder = () => new MockEmbeddingModelV4({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }) });
const type1 = () => new Experimental_EvaluationMockModelV4({ doEvaluate: async () => ({ answers: {}, warnings: [] }) });
const type2 = () => new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream() }) });

const brain = () => createBrain({ db, embedder: embedder(), type1: type1(), type2: { light: type2(), heavy: type2() }, now: () => now, random: () => 0.5 });

async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt, awakeSince: bornAt, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5, ...extra })
    .returning();
  return row!;
}

async function insertPerson(name: string, extra: Partial<typeof persons.$inferInsert> = {}) {
  const [row] = await db.insert(persons).values({ name, ...extra }).returning();
  return row!;
}

async function insertFaceEmbedding(personId: number, createdAt: Date) {
  const embedding = new Array<number>(1024).fill(0);
  const [row] = await db.insert(faceEmbeddings).values({ personId, embedding, createdAt }).returning();
  return row!;
}

async function insertVoiceProfile(personId: number, createdAt: Date) {
  const [row] = await db.insert(voiceProfiles).values({ personId, profile: new Uint8Array([1]), createdAt }).returning();
  return row!;
}

async function insertMemory(dynimoId: number, personId: number | null, text = "Hoi") {
  const [row] = await db
    .insert(memories)
    .values({ dynimoId, personId, text, embedding: new Array<number>(1536).fill(0), createdAt: now })
    .returning();
  return row!;
}

const minutesApart = (index: number) => new Date(now.getTime() - index * 60_000);

describe("listPersons (#95)", () => {
  it("geeft elke Persoon met zijn aantal gezichten/stemprofielen/Herinneringen, eigenaar eerst", async () => {
    const owner = await insertPerson("eigenaar", { owner: true });
    const anna = await insertPerson("Anna");
    const vero = await insertDynimo();
    // faceCount en voiceCount bewust ongelijk (2 vs 1): anders vangt deze test een verwisseling van de twee tellers niet.
    await insertFaceEmbedding(anna.id, now);
    await insertFaceEmbedding(anna.id, now);
    await insertVoiceProfile(anna.id, now);
    await insertMemory(vero.id, anna.id);
    await insertMemory(vero.id, anna.id);

    const rows = await brain().listPersons();

    expect(rows.map((row) => row.id)).toEqual([owner.id, anna.id]);
    const annaRow = rows.find((row) => row.id === anna.id)!;
    expect(annaRow).toMatchObject({ name: "Anna", owner: false, faceCount: 2, voiceCount: 1, memoryCount: 2 });
    const ownerRow = rows.find((row) => row.id === owner.id)!;
    expect(ownerRow).toMatchObject({ owner: true, faceCount: 0, voiceCount: 0, memoryCount: 0 });
  });
});

describe("renamePerson (#95)", () => {
  it("hernoemt een bestaande Persoon", async () => {
    const anna = await insertPerson("Ana");
    expect(await brain().renamePerson(anna.id, "Anna")).toBe(true);
    const [row] = await db.select().from(persons).where(eq(persons.id, anna.id));
    expect(row!.name).toBe("Anna");
  });

  it("mag de eigenaar ook hernoemen; de owner-vlag blijft staan", async () => {
    const owner = await insertPerson("eigenaar", { owner: true });
    expect(await brain().renamePerson(owner.id, "Bram")).toBe(true);
    const [row] = await db.select().from(persons).where(eq(persons.id, owner.id));
    expect(row).toMatchObject({ name: "Bram", owner: true });
  });

  it("false bij een onbekende id", async () => {
    expect(await brain().renamePerson(999, "Anna")).toBe(false);
  });

  it("false bij een ongeldige naam (te lang, of ongeldige tekens); niets wordt gewijzigd", async () => {
    const anna = await insertPerson("Anna");
    expect(await brain().renamePerson(anna.id, "a".repeat(41))).toBe(false);
    expect(await brain().renamePerson(anna.id, "Anna123")).toBe(false);
    const [row] = await db.select().from(persons).where(eq(persons.id, anna.id));
    expect(row!.name).toBe("Anna");
  });

  it("trimt en accepteert accenten, spatie, koppelteken en apostrof", async () => {
    const anna = await insertPerson("Anna");
    expect(await brain().renamePerson(anna.id, "  Jean-Luc O'Néill  ")).toBe(true);
    const [row] = await db.select().from(persons).where(eq(persons.id, anna.id));
    expect(row!.name).toBe("Jean-Luc O'Néill");
  });
});

describe("deletePerson (#95)", () => {
  it("verwijdert een Persoon; embeddings en stemprofielen gaan mee, Herinneringen blijven zonder Persoon", async () => {
    const anna = await insertPerson("Anna");
    const vero = await insertDynimo();
    await insertFaceEmbedding(anna.id, now);
    await insertVoiceProfile(anna.id, now);
    const memory = await insertMemory(vero.id, anna.id);

    expect(await brain().deletePerson(anna.id, "Anna")).toBe(true);

    expect(await db.select().from(persons).where(eq(persons.id, anna.id))).toHaveLength(0);
    expect(await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id))).toHaveLength(0);
    expect(await db.select().from(voiceProfiles).where(eq(voiceProfiles.personId, anna.id))).toHaveLength(0);
    const [remainingMemory] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(remainingMemory!.personId).toBeNull();
  });

  it("false bij een foute naam; niets wordt verwijderd (zoals kill)", async () => {
    const anna = await insertPerson("Anna");
    expect(await brain().deletePerson(anna.id, "Ana")).toBe(false);
    expect(await db.select().from(persons).where(eq(persons.id, anna.id))).toHaveLength(1);
  });

  it("false voor de eigenaar, ook met de juiste naam; niets wordt verwijderd", async () => {
    const owner = await insertPerson("eigenaar", { owner: true });
    expect(await brain().deletePerson(owner.id, "eigenaar")).toBe(false);
    expect(await db.select().from(persons).where(eq(persons.id, owner.id))).toHaveLength(1);
  });

  it("false bij een onbekende id", async () => {
    expect(await brain().deletePerson(999, "wie dan ook")).toBe(false);
  });

  it("meldt \"persons:\" op het toestandskanaal bij succes", async () => {
    const anna = await insertPerson("Anna");
    const listener = await listenState();
    try {
      expect(await brain().deletePerson(anna.id, "Anna")).toBe(true);
      expect(await listener.settle()).toEqual(["persons:"]);
    } finally {
      await listener.close();
    }
  });

  it("meldt niets op het toestandskanaal bij een foute naam", async () => {
    const anna = await insertPerson("Anna");
    const listener = await listenState();
    try {
      expect(await brain().deletePerson(anna.id, "Fout")).toBe(false);
      expect(await listener.settle()).toEqual([]);
    } finally {
      await listener.close();
    }
  });
});

describe("relearnPerson (#95)", () => {
  it("wist gezichts-embeddings en stemprofielen; de Persoon, Herinneringen en Vertrouwdheid blijven", async () => {
    const anna = await insertPerson("Anna");
    const vero = await insertDynimo();
    await insertFaceEmbedding(anna.id, now);
    await insertVoiceProfile(anna.id, now);
    const memory = await insertMemory(vero.id, anna.id);
    await db.insert(familiarities).values({ dynimoId: vero.id, personId: anna.id, familiarity: 0.6 });

    expect(await brain().relearnPerson(anna.id)).toBe(true);

    expect(await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id))).toHaveLength(0);
    expect(await db.select().from(voiceProfiles).where(eq(voiceProfiles.personId, anna.id))).toHaveLength(0);
    expect(await db.select().from(persons).where(eq(persons.id, anna.id))).toHaveLength(1);
    expect(await db.select().from(memories).where(eq(memories.id, memory.id))).toHaveLength(1);
    const [familiarity] = await db.select().from(familiarities).where(eq(familiarities.personId, anna.id));
    expect(familiarity!.familiarity).toBe(0.6);
  });

  it("false bij een onbekende id", async () => {
    expect(await brain().relearnPerson(999)).toBe(false);
  });

  it("meldt \"persons:\" op het toestandskanaal bij succes", async () => {
    const anna = await insertPerson("Anna");
    const listener = await listenState();
    try {
      expect(await brain().relearnPerson(anna.id)).toBe(true);
      expect(await listener.settle()).toEqual(["persons:"]);
    } finally {
      await listener.close();
    }
  });

  it("meldt niets op het toestandskanaal bij een onbekende id", async () => {
    const listener = await listenState();
    try {
      expect(await brain().relearnPerson(999)).toBe(false);
      expect(await listener.settle()).toEqual([]);
    } finally {
      await listener.close();
    }
  });
});

describe("mergePersons (#95)", () => {
  it("false bij gelijke ids", async () => {
    const anna = await insertPerson("Anna");
    expect(await brain().mergePersons(anna.id, anna.id)).toBe(false);
  });

  it("false bij een onbekende keepId of removeId", async () => {
    const anna = await insertPerson("Anna");
    expect(await brain().mergePersons(999, anna.id)).toBe(false);
    expect(await brain().mergePersons(anna.id, 999)).toBe(false);
  });

  it("verhuist Herinneringen en embeddings van removeId naar keepId, en verwijdert removeId", async () => {
    const anna = await insertPerson("Anna");
    const anna2 = await insertPerson("Anna2");
    const vero = await insertDynimo();
    const memory = await insertMemory(vero.id, anna2.id);
    await insertFaceEmbedding(anna2.id, now);
    await insertVoiceProfile(anna2.id, now);

    expect(await brain().mergePersons(anna.id, anna2.id)).toBe(true);

    expect(await db.select().from(persons).where(eq(persons.id, anna2.id))).toHaveLength(0);
    const [movedMemory] = await db.select().from(memories).where(eq(memories.id, memory.id));
    expect(movedMemory!.personId).toBe(anna.id);
    expect(await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id))).toHaveLength(1);
    expect(await db.select().from(voiceProfiles).where(eq(voiceProfiles.personId, anna.id))).toHaveLength(1);
  });

  it("houdt na het samenvoegen hoogstens 5 gezichts- en stemprofielen (de nieuwste)", async () => {
    const anna = await insertPerson("Anna");
    const anna2 = await insertPerson("Anna2");
    for (let i = 0; i < 3; i++) await insertFaceEmbedding(anna.id, minutesApart(20 + i));
    for (let i = 0; i < 4; i++) await insertFaceEmbedding(anna2.id, minutesApart(10 + i));
    for (let i = 0; i < 3; i++) await insertVoiceProfile(anna.id, minutesApart(20 + i));
    for (let i = 0; i < 4; i++) await insertVoiceProfile(anna2.id, minutesApart(10 + i));

    expect(await brain().mergePersons(anna.id, anna2.id)).toBe(true);

    const faces = await db.select().from(faceEmbeddings).where(eq(faceEmbeddings.personId, anna.id));
    expect(faces).toHaveLength(5);
    const voices = await db.select().from(voiceProfiles).where(eq(voiceProfiles.personId, anna.id));
    expect(voices).toHaveLength(5);
  });

  it("houdt per Dynimo de hoogste Vertrouwdheid van beide Personen over op keepId", async () => {
    const anna = await insertPerson("Anna");
    const anna2 = await insertPerson("Anna2");
    const vero = await insertDynimo();
    const rico = await insertDynimo({ name: "Rico", awakeSince: null });
    await db.insert(familiarities).values([
      { dynimoId: vero.id, personId: anna.id, familiarity: 0.3 },
      { dynimoId: vero.id, personId: anna2.id, familiarity: 0.8 }, // hoogste, komt van removeId
      { dynimoId: rico.id, personId: anna2.id, familiarity: 0.5 }, // enkel bij removeId
    ]);

    expect(await brain().mergePersons(anna.id, anna2.id)).toBe(true);

    const rows = await db.select().from(familiarities).where(eq(familiarities.personId, anna.id));
    const byDynimo = new Map(rows.map((row) => [row.dynimoId, row.familiarity]));
    expect(byDynimo.get(vero.id)).toBe(0.8);
    expect(byDynimo.get(rico.id)).toBe(0.5);
  });

  it("geen van beiden is de eigenaar: keepId blijft geen eigenaar na het samenvoegen", async () => {
    const anna = await insertPerson("Anna");
    const anna2 = await insertPerson("Anna2");

    expect(await brain().mergePersons(anna.id, anna2.id)).toBe(true);

    const [row] = await db.select().from(persons).where(eq(persons.id, anna.id));
    expect(row!.owner).toBe(false);
  });

  it("removeId is de eigenaar: de owner-vlag gaat naar keepId", async () => {
    const anna = await insertPerson("Anna");
    const owner = await insertPerson("eigenaar", { owner: true });

    expect(await brain().mergePersons(anna.id, owner.id)).toBe(true);

    const [row] = await db.select().from(persons).where(eq(persons.id, anna.id));
    expect(row!.owner).toBe(true);
  });

  it("keepId is al de eigenaar: de owner-vlag blijft bij keepId", async () => {
    const owner = await insertPerson("eigenaar", { owner: true });
    const anna = await insertPerson("Anna");

    expect(await brain().mergePersons(owner.id, anna.id)).toBe(true);

    const [row] = await db.select().from(persons).where(eq(persons.id, owner.id));
    expect(row!.owner).toBe(true);
  });

  it("meldt \"persons:\" op het toestandskanaal bij succes", async () => {
    const anna = await insertPerson("Anna");
    const anna2 = await insertPerson("Anna2");
    const listener = await listenState();
    try {
      expect(await brain().mergePersons(anna.id, anna2.id)).toBe(true);
      expect(await listener.settle()).toEqual(["persons:"]);
    } finally {
      await listener.close();
    }
  });

  it("meldt niets op het toestandskanaal bij gelijke of onbekende ids", async () => {
    const anna = await insertPerson("Anna");
    const listener = await listenState();
    try {
      expect(await brain().mergePersons(anna.id, anna.id)).toBe(false);
      expect(await brain().mergePersons(anna.id, 999)).toBe(false);
      expect(await listener.settle()).toEqual([]);
    } finally {
      await listener.close();
    }
  });
});
