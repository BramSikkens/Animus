// #126: Herinnering opslaan via de wachtrij i.p.v. fire-and-forget in hetzelfde proces (#109). `remember()` plant
// enkel een `herinnering`-job in; de "worker" hier is een tweede brain-instantie waarvan de fake job queue
// `storeMemory()` aanroept, zodat de producer (met `deps.jobs`) en de opslag (zonder) los van elkaar te sturen zijn.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingModelV4, MockLanguageModelV4, Experimental_EvaluationMockModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, dynimos, memories, persons } from "@animus/db/schema";
import { EMOTIONS } from "../src/emotion.js";
import { createBrain } from "../src/index.js";
import type { JobPayloads } from "../src/jobs.js";
import type { Gesprekspartner } from "../src/perception.js";
import { createTestDb, truncateAll } from "./db.js";

const db = createTestDb();
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

// Neutraal Type1: geen delta's van betekenis, "simpel" intent — een gewone beurt die de LLM bereikt.
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

function reliableEmbedder() {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({ embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] }),
  });
}

/** Faalt de eerste `failTimes` embed-calls (simuleert een embed-fout in storeMemory), lukt daarna. */
function flakyEmbedder(failTimes: number) {
  let calls = 0;
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => {
      calls++;
      if (calls <= failTimes) throw new Error("embed-fout (test)");
      return { embeddings: values.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0)), warnings: [] };
    },
  });
}

function textChunk(text: string) {
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

function singleTextModel(text: string) {
  return new MockLanguageModelV4({ doStream: async () => textChunk(text) });
}

function toolCallChunk(toolName: string, input: object) {
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

async function insertDynimo(extra: Partial<typeof dynimos.$inferInsert> = {}) {
  const [row] = await db
    .insert(dynimos)
    .values({ name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt: now, awakeSince: now, baseEmotion: "kalm", axisIe: 0.5, axisSn: 0.5, axisTf: 0.5, axisJp: 0.5, ...extra })
    .returning();
  return row!;
}

async function insertPerson(name: string) {
  const [row] = await db.insert(persons).values({ name }).returning();
  return row!;
}

async function hear(brain: ReturnType<typeof createBrain>, text: string, options?: { gesprekspartner?: Gesprekspartner }) {
  for await (const _ of brain.hear(text, options)) void _;
}

/** Een "worker"-brain: geen jobs-dep, storeMemory() gaat rechtstreeks naar de db — precies wat de echte worker doet. */
function workerBrain(embedder: MockEmbeddingModelV4) {
  return createBrain({ db, embedder, type1: type1(), type2: { light: unusedModel(), heavy: unusedModel() }, now: () => now, random: () => 0.99 });
}

/**
 * Fake jobs-dep (#126) voor de brain-tests: `enqueue("herinnering", …)` voert de job asynchroon uit via
 * `worker.storeMemory`, `finished(job)` geeft dat resultaat terug. `gate` (optioneel) houdt de uitvoering op tot
 * de test hem vrijgeeft — zo kan een test controleren wanneer de job "klaar" is. `failAttempts` simuleert een
 * embed-fout die BullMQ zou herkansen: de eerste N pogingen falen, dan pas roept de fake `storeMemory` weer aan.
 */
function fakeMemoryJobQueue(worker: { storeMemory: (payload: JobPayloads["herinnering"]) => Promise<{ id: number }> }, options: { gate?: Promise<void>; failAttempts?: number } = {}) {
  const enqueued: JobPayloads["herinnering"][] = [];
  const jobs = new Map<string, Promise<unknown>>();
  let seq = 0;
  return {
    enqueued,
    enqueue: vi.fn(async (name: string, payload: unknown) => {
      if (name !== "herinnering") throw new Error(`fake ondersteunt geen job "${name}"`);
      const id = `job-${++seq}`;
      const p = payload as JobPayloads["herinnering"];
      enqueued.push(p);
      const run = (async () => {
        if (options.gate) await options.gate;
        const maxAttempts = (options.failAttempts ?? 0) + 1;
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await worker.storeMemory(p);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      })();
      run.catch(() => {}); // niet elke test roept finished() af; anders een unhandled rejection bij een gefaalde job
      jobs.set(id, run);
      return { id } as Job;
    }),
    finished: vi.fn(async (job: Job) => jobs.get(job.id as string)),
  };
}

describe("Herinnering opslaan via de wachtrij (#126)", () => {
  it("storeMemory: FK-terugval van #107 (Persoon intussen verwijderd) en het model-veld", async () => {
    const vero = await insertDynimo();
    const worker = workerBrain(reliableEmbedder());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { id } = await worker.storeMemory({ dynimoId: vero.id, personId: 999_999, text: "Hoi", impression: 0.5, model: "anthropic:claude" });

    const [row] = await db.select().from(memories).where(eq(memories.id, id));
    expect(row!.personId).toBeNull();
    expect(row!.model).toBe("anthropic:claude");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bestaat niet (meer)"));
    warn.mockRestore();
  });

  it("storeMemory slaat een geldige Persoon en model gewoon op", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    const worker = workerBrain(reliableEmbedder());

    const { id } = await worker.storeMemory({ dynimoId: vero.id, personId: anna.id, text: "Hoi", impression: 0.7, model: null });

    const [row] = await db.select().from(memories).where(eq(memories.id, id));
    expect(row!.personId).toBe(anna.id);
    expect(row!.impression).toBe(0.7);
    expect(row!.model).toBeNull();
  });

  it("remember() met deps.jobs: plant een herinnering-job in en geeft meteen true (de stream eindigt vóórdat de Herinnering echt opgeslagen is)", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = workerBrain(reliableEmbedder());
    const jobs = fakeMemoryJobQueue(worker, { gate });
    const model = singleTextModel("Hoi!");
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });

    await hear(brain, "Hoi", { gesprekspartner: { soort: "persoon", personId: anna.id } });

    // De beurt is klaar, maar de job hangt nog op de gate: nog niets in de db.
    expect(await db.select().from(memories)).toHaveLength(0);
    expect(jobs.enqueued).toHaveLength(1);
    expect(jobs.enqueued[0]).toMatchObject({ dynimoId: vero.id, personId: anna.id });

    release();
    await brain.settled();

    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(anna.id);
  });

  it("remember() met deps.jobs: een embed-fout wordt herkanst en lukt alsnog", async () => {
    const vero = await insertDynimo();
    const worker = workerBrain(flakyEmbedder(2));
    const jobs = fakeMemoryJobQueue(worker, { failAttempts: 2 });
    const model = singleTextModel("Hoi!");
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });

    await hear(brain, "Hoi");
    await brain.settled();

    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows).toHaveLength(1);
  });

  it("remember() met deps.jobs: na het maximum aantal pogingen wordt de fout gelogd, zonder de beurt te breken", async () => {
    const vero = await insertDynimo();
    const worker = workerBrain(flakyEmbedder(Infinity));
    const jobs = fakeMemoryJobQueue(worker, { failAttempts: 4 });
    const model = singleTextModel("Hoi!");
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const events: string[] = [];
    for await (const event of brain.hear("Hoi")) if (event.type === "text") events.push(event.delta);
    expect(events.join("")).toContain("Hoi!"); // de beurt zelf brak niet

    await brain.settled();

    expect(await db.select().from(memories).where(eq(memories.dynimoId, vero.id))).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("Herinnering opslaan (via job) faalde:", expect.any(String));
    warn.mockRestore();
  });

  it("een inplan-fout (enqueue gooit) wordt gelogd en remember() geeft false", async () => {
    await insertDynimo();
    const worker = workerBrain(reliableEmbedder());
    const jobs = fakeMemoryJobQueue(worker);
    jobs.enqueue.mockRejectedValueOnce(new Error("redis plat"));
    const model = singleTextModel("Hoi!");
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await hear(brain, "Hoi");
    await brain.settled();

    expect(warn).toHaveBeenCalledWith("Herinnering inplannen faalde:", expect.any(String));
    expect(await db.select().from(memories)).toHaveLength(0);
    warn.mockRestore();
  });

  it("de onthoud-tool meldt onthouden zodra de herinnering-job ingepland is, zonder op de opslag te wachten", async () => {
    const vero = await insertDynimo();
    const anna = await insertPerson("Anna");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = workerBrain(reliableEmbedder());
    const jobs = fakeMemoryJobQueue(worker, { gate });
    const model = new MockLanguageModelV4({ doStream: [toolCallChunk("remember", { text: "Anna houdt van thee." }), textChunk("Onthouden!")] });
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });

    let remembered: unknown;
    for await (const event of brain.hear("Onthoud dat ik van thee houd", { gesprekspartner: { soort: "persoon", personId: anna.id } })) {
      if (event.type === "tool-result" && event.toolName === "remember") remembered = (event.output as { remembered: boolean }).remembered;
    }

    expect(remembered).toBe(true);
    expect(await db.select().from(memories)).toHaveLength(0); // nog niet opgeslagen: de job hangt op de gate
    release();
    await brain.settled();
    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows.some((row) => row.text === "Anna houdt van thee.")).toBe(true);
  });

  it("leerKennen koppelt een Herinnering die nog in de wachtrij zit (settled() wacht op de job)", async () => {
    await insertDynimo();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = workerBrain(reliableEmbedder());
    const jobs = fakeMemoryJobQueue(worker, { gate });
    const model = new MockLanguageModelV4({
      doStream: [
        textChunk("Hoi!"), // eerste beurt (onbekend): eind-Herinnering gaat de wachtrij in, gated
        toolCallChunk("leerKennen", { naam: "Bo" }),
        textChunk("Hoi Bo!"),
      ],
    });
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });

    await hear(brain, "Hoi", { gesprekspartner: { soort: "onbekend" } });
    expect(await db.select().from(memories)).toHaveLength(0); // nog niets: de job hangt op de gate

    const secondTurn = hear(brain, "Ik heet Bo", { gesprekspartner: { soort: "onbekend" } });
    release();
    await secondTurn;
    await brain.settled();

    const bo = (await db.select().from(persons).where(eq(persons.name, "Bo")))[0]!;
    const rows = await db.select().from(memories);
    // Twee Herinneringen (A's eerste, in de wachtrij vastgehangen beurt + B's eigen eind-Herinnering); de eerste
    // was toen hij opgeslagen werd nog personId null en is via leerKennenPersoon's settled() alsnog aan Bo gekoppeld.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.personId === bo.id)).toBe(true);
  });

  it("een Herinnering van A die pas klaar is ná de wissel naar B komt niet in B's sessie (#114, ook met jobs)", async () => {
    const a = await insertDynimo({ name: "Aya" });
    await insertDynimo({ name: "Bo", awakeSince: null });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = workerBrain(reliableEmbedder());
    const jobs = fakeMemoryJobQueue(worker, { gate });
    const model = new MockLanguageModelV4({
      doStream: [
        textChunk("Hoi!"), // A's beurt (onbekend): eind-Herinnering gated
        toolCallChunk("leerKennen", { naam: "Bo" }), // B's leerKennen, ná de wissel
        textChunk("Hoi Bo!"),
      ],
    });
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99, jobs });

    await hear(brain, "Hoi", { gesprekspartner: { soort: "onbekend" } });
    expect(await db.select().from(memories)).toHaveLength(0);

    // Wissel: A slaapt, B wordt wakker (nieuwe sessie), vóórdat A's job klaar is.
    await db.update(dynimos).set({ awakeSince: null }).where(eq(dynimos.id, a.id));
    await db.update(dynimos).set({ awakeSince: new Date(now.getTime() + 1000) }).where(eq(dynimos.name, "Bo"));
    await brain.recognizeFaces([]);

    release();
    await brain.settled(); // A's job komt nu alsnog binnen, in A's eigen (niet meer actuele) sessie

    const aMemories = await db.select().from(memories).where(eq(memories.dynimoId, a.id));
    expect(aMemories).toHaveLength(1);
    expect(aMemories[0]!.personId).toBeNull();

    // B's leerKennen: als A's Herinnering per ongeluk in B's unknownSessionMemoryIds beland was, koppelt dit hem
    // aan Bo (leerKennenPersoon filtert niet op dynimoId).
    await hear(brain, "Ik heet Bo", { gesprekspartner: { soort: "onbekend" } });
    await brain.settled();

    const boPerson = (await db.select().from(persons).where(eq(persons.name, "Bo")))[0]!;
    expect(boPerson).toBeTruthy();
    const stillA = await db.select().from(memories).where(eq(memories.dynimoId, a.id));
    expect(stillA[0]!.personId).toBeNull();
  });

  it("remember() zonder deps.jobs: ongewijzigd gedrag (rechtstreekse opslag, geen job)", async () => {
    const vero = await insertDynimo();
    const model = singleTextModel("Hoi!");
    const brain = createBrain({ db, embedder: reliableEmbedder(), type1: type1(), type2: { light: model, heavy: model }, now: () => now, random: () => 0.99 });

    await hear(brain, "Hoi");
    await brain.settled();

    const rows = await db.select().from(memories).where(eq(memories.dynimoId, vero.id));
    expect(rows).toHaveLength(1);
  });
});
