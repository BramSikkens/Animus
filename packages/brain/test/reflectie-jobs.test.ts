import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import type { Job } from "bullmq";
import { EMBEDDING_DIMENSIONS, dynimos, memories } from "@animus/db/schema";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createBrain, STATE_CHANNEL, STATE_PREFIXES } from "../src/index.js";
import { createTestDb, databaseUrl, TEST_DB_NAME, truncateAll } from "./db.js";

const db = createTestDb();
const bornAt = new Date("2026-01-01T12:00:00.000Z");
const MIN = 60_000;

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

function generateResult(text: string) {
  return { content: [{ type: "text" as const, text }], finishReason: STOP, usage: NULL_USAGE, warnings: [] };
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

function fakeVector(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = text.length % 2;
  return vector;
}

function embedModel() {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(fakeVector), warnings: [] }),
  });
}

function type1Model(): Experimental_EvaluationMockModelV4 {
  return new Experimental_EvaluationMockModelV4({
    doEvaluate: async () => {
      throw new Error("Type1-model had niet aangeroepen mogen worden");
    },
  });
}

const noOps = { add: [], closeGoals: [], drop: [] };
const reflection = (over: Record<string, unknown> = {}) => ({
  evolvedCharacter: "Wat rustiger geworden.",
  axisShifts: { ie: 0, sn: 0, tf: 0, jp: 0, reactivity: 0, expressiveness: 0 },
  verstandShift: 0,
  drives: noOps,
  wakeMood: { emotion: "kalm", intensity: 0.4 },
  dream: null,
  ...over,
});
const heavyReturning = (result: unknown) =>
  new MockLanguageModelV4({ doGenerate: async () => generateResult(JSON.stringify(result)) });

async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
  const [row] = await db
    .insert(dynimos)
    .values({
      name: "Vero",
      coreCharacter: "Rustig en oplettend.",
      birthStory: "Geboren.",
      seed: "z",
      bornAt,
      awakeSince: bornAt,
      baseEmotion: "kalm",
      axisIe: 0.5,
      axisSn: 0.5,
      axisTf: 0.5,
      axisJp: 0.5,
      ...extra,
    })
    .returning();
  return row!;
}

async function addMemory(dynimoId: number, text: string, minutes: number) {
  await db.insert(memories).values({
    dynimoId,
    text,
    embedding: fakeVector(text),
    createdAt: new Date(bornAt.getTime() + minutes * MIN),
    impression: 0.5,
  });
}

const rowOf = async (id: number) => (await db.select().from(dynimos).where(eq(dynimos.id, id)))[0]!;

function fakeJobQueue() {
  const enqueued: { name: string; payload: unknown; opts: unknown }[] = [];
  let fail: Error | undefined;
  return {
    enqueued,
    failNext(error: Error) {
      fail = error;
    },
    enqueue: vi.fn(async (name: string, payload: unknown, opts?: unknown) => {
      if (fail) {
        const error = fail;
        fail = undefined;
        throw error;
      }
      enqueued.push({ name, payload, opts });
      return { id: "fake-job-id" } as Job;
    }),
    // Reflectie-jobs wachten nooit op hun resultaat (#125); enkel hier om aan JobsDep te voldoen.
    finished: vi.fn(async () => ({})),
  };
}

function brainWith(options: { heavy?: MockLanguageModelV4; jobs?: ReturnType<typeof fakeJobQueue> } = {}) {
  return createBrain({
    db,
    embedder: embedModel(),
    type1: type1Model(),
    type2: { light: unusedModel(), heavy: options.heavy ?? unusedModel() },
    now: () => bornAt,
    random: () => 0,
    jobs: options.jobs,
  });
}

describe("Reflectie via de wachtrij (#125)", () => {
  describe("reflectAll (sleep/wake/bringToLife) met jobs-dep", () => {
    it("plant per wakker geworden id een reflectie-job in i.p.v. zelf te reflecteren, en wacht er niet op", async () => {
      const vero = await insertDynimo();
      await addMemory(vero.id, "iets", 1);
      const jobs = fakeJobQueue();
      const brain = brainWith({ jobs });

      await brain.sleep();

      expect(jobs.enqueued).toEqual([
        { name: "reflectie", payload: { dynimoId: vero.id, sleeping: true }, opts: { deduplication: { id: `reflectie:${vero.id}` } } },
      ]);
      // Geen Type2-call: de brain zelf reflecteerde niet, dat doet de worker.
      const row = await rowOf(vero.id);
      expect(row.lastReflectedAt).toBeNull();
    });

    it("een fout bij het inplannen wordt gelogd en breekt het slapen niet", async () => {
      const vero = await insertDynimo();
      const jobs = fakeJobQueue();
      jobs.failNext(new Error("redis plat"));
      const brain = brainWith({ jobs });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(brain.sleep()).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalled();
      expect((await rowOf(vero.id)).awakeSince).toBeNull();
      warn.mockRestore();
    });
  });

  describe("reflect() bij stilte met jobs-dep", () => {
    it("plant een reflectie-job (sleeping: false, met aanwezig) in voor de wakkere Dynimo en geeft true terug", async () => {
      const vero = await insertDynimo();
      const jobs = fakeJobQueue();
      const brain = brainWith({ jobs });

      const result = await brain.reflect({ aanwezig: [7] });

      expect(result).toBe(true);
      expect(jobs.enqueued).toEqual([
        { name: "reflectie", payload: { dynimoId: vero.id, sleeping: false, aanwezig: [7] }, opts: { deduplication: { id: `reflectie:${vero.id}` } } },
      ]);
    });

    it("geeft false zonder in te plannen als niemand wakker is", async () => {
      await insertDynimo({ awakeSince: null });
      const jobs = fakeJobQueue();
      const brain = brainWith({ jobs });

      expect(await brain.reflect()).toBe(false);
      expect(jobs.enqueued).toEqual([]);
    });
  });

  describe("reflect() en reflectAll() zonder jobs-dep: ongewijzigd gedrag", () => {
    it("reflect() reflecteert nog steeds direct (geen jobs meegegeven)", async () => {
      const vero = await insertDynimo();
      await addMemory(vero.id, "iets", 1);
      const brain = brainWith({ heavy: heavyReturning(reflection()) });

      expect(await brain.reflect()).toBe(true);
      expect((await rowOf(vero.id)).evolvedCharacter).toBe("Wat rustiger geworden.");
    });
  });

  describe("runReflection() (worker)", () => {
    async function listen() {
      const client = postgres(databaseUrl(TEST_DB_NAME), { onnotice: () => {} });
      const received: string[] = [];
      await client.listen(STATE_CHANNEL, (payload) => received.push(payload));
      const settle = async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return received;
      };
      return { received, settle, close: () => client.end() };
    }

    it("meldt start en einde op STATE_CHANNEL rond een geslaagde Reflectie", async () => {
      const vero = await insertDynimo();
      await addMemory(vero.id, "iets", 1);
      const brain = brainWith({ heavy: heavyReturning(reflection()) });
      const listener = await listen();

      try {
        await brain.runReflection(vero.id, { sleeping: true });
        const received = await listener.settle();
        expect(received).toEqual([`${STATE_PREFIXES.reflectie}start:${vero.id}`, `kenmerken:${vero.id}`, `${STATE_PREFIXES.reflectie}einde:${vero.id}`]);
      } finally {
        await listener.close();
      }
    });

    it("meldt geen start/einde als er niets te reflecteren valt (geen nieuwe Herinneringen)", async () => {
      const vero = await insertDynimo();
      const brain = brainWith({ heavy: heavyReturning(reflection()) });
      const listener = await listen();

      try {
        await brain.runReflection(vero.id, { sleeping: true });
        const received = await listener.settle();
        expect(received).toEqual([]);
      } finally {
        await listener.close();
      }
    });

    it("gooit door bij een falende Type2-call (i.t.t. reflect(), dat nooit gooit) en meldt toch \"einde\"", async () => {
      const vero = await insertDynimo();
      await addMemory(vero.id, "iets", 1);
      const failing = new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("model plat");
        },
      });
      const brain = brainWith({ heavy: failing });
      const listener = await listen();

      try {
        await expect(brain.runReflection(vero.id, { sleeping: true })).rejects.toThrow("model plat");
        const received = await listener.settle();
        expect(received).toEqual([`${STATE_PREFIXES.reflectie}start:${vero.id}`, `${STATE_PREFIXES.reflectie}einde:${vero.id}`]);
      } finally {
        await listener.close();
      }
    });
  });
});
