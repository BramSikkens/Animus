import { Queue, QueueEvents } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJobQueue, QUEUE_NAME, scheduleBackfill, startWorker } from "../src/jobs.js";

const REDIS_URL = process.env.REDIS_URL ?? process.env.TEST_REDIS_URL ?? "redis://localhost:6379";

/** Ruimt de Redis-keys van een testprefix op (bullmq's eigen obliterate, vóór het sluiten van de connecties). */
async function obliterate(prefix: string): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL }, prefix });
  await queue.obliterate({ force: true });
  await queue.close();
}

describe("jobs", () => {
  let cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanup.map((fn) => fn()));
    cleanup = [];
  });

  it("voert een enqueued ping-job uit via de worker en geeft het resultaat terug", async () => {
    const prefix = `animus_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const queue = createJobQueue({ connection: REDIS_URL, prefix });
    const worker = startWorker({
      connection: REDIS_URL,
      prefix,
      handlers: {
        ping: async (payload) => ({ pong: payload.value * 2 }),
      },
    });
    const queueEvents = new QueueEvents(QUEUE_NAME, { connection: { url: REDIS_URL }, prefix });
    await queueEvents.waitUntilReady();
    cleanup.push(() => queueEvents.close());
    cleanup.push(() => worker.close());
    cleanup.push(() => queue.close());
    cleanup.push(() => obliterate(prefix));

    const job = await queue.enqueue("ping", { value: 21 });
    const result = await job.waitUntilFinished(queueEvents);

    expect(result).toEqual({ pong: 42 });
  });

  it("herkanst een gefaalde ping-job en slaagt bij de retry", async () => {
    const prefix = `animus_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const queue = createJobQueue({ connection: REDIS_URL, prefix });
    let attempts = 0;
    const worker = startWorker({
      connection: REDIS_URL,
      prefix,
      handlers: {
        ping: async (payload) => {
          attempts += 1;
          if (attempts === 1) throw new Error("eerste poging faalt expres");
          return { pong: payload.value * 2 };
        },
      },
    });
    const queueEvents = new QueueEvents(QUEUE_NAME, { connection: { url: REDIS_URL }, prefix });
    await queueEvents.waitUntilReady();
    cleanup.push(() => queueEvents.close());
    cleanup.push(() => worker.close());
    cleanup.push(() => queue.close());
    cleanup.push(() => obliterate(prefix));

    const job = await queue.enqueue(
      "ping",
      { value: 5 },
      { attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );
    const result = await job.waitUntilFinished(queueEvents);

    expect(result).toEqual({ pong: 10 });
    expect(attempts).toBe(2);
  });

  it("logt een job die definitief faalt (na de laatste poging) via console.warn", async () => {
    const prefix = `animus_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const queue = createJobQueue({ connection: REDIS_URL, prefix });
    const worker = startWorker({
      connection: REDIS_URL,
      prefix,
      handlers: {
        ping: async () => {
          throw new Error("blijft falen");
        },
      },
    });
    const queueEvents = new QueueEvents(QUEUE_NAME, { connection: { url: REDIS_URL }, prefix });
    await queueEvents.waitUntilReady();
    cleanup.push(() => queueEvents.close());
    cleanup.push(() => worker.close());
    cleanup.push(() => queue.close());
    cleanup.push(() => obliterate(prefix));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const job = await queue.enqueue("ping", { value: 1 }, { attempts: 1 });
    await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 150)); // worker's eigen "failed"-event kan later komen dan queueEvents

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`ping.*${job.id}`)), expect.stringContaining("blijft falen"));
    warn.mockRestore();
  });

  it("finished() geeft het resultaat van de job via een eigen, gedeelde QueueEvents (#126)", async () => {
    const prefix = `animus_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const queue = createJobQueue({ connection: REDIS_URL, prefix });
    const worker = startWorker({
      connection: REDIS_URL,
      prefix,
      handlers: {
        ping: async (payload) => ({ pong: payload.value * 2 }),
      },
    });
    cleanup.push(() => worker.close());
    cleanup.push(() => queue.close());
    cleanup.push(() => obliterate(prefix));

    const job = await queue.enqueue("ping", { value: 21 });
    const result = await queue.finished(job);

    expect(result).toEqual({ pong: 42 });
  });

  it("dedupliceert: een tweede enqueue met dezelfde deduplication-id terwijl de eerste nog loopt roept de handler één keer aan", async () => {
    const prefix = `animus_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const queue = createJobQueue({ connection: REDIS_URL, prefix });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const worker = startWorker({
      connection: REDIS_URL,
      prefix,
      handlers: {
        reflectie: async () => {
          calls += 1;
          await gate;
        },
      },
    });
    const queueEvents = new QueueEvents(QUEUE_NAME, { connection: { url: REDIS_URL }, prefix });
    await queueEvents.waitUntilReady();
    cleanup.push(() => queueEvents.close());
    cleanup.push(() => worker.close());
    cleanup.push(() => queue.close());
    cleanup.push(() => obliterate(prefix));

    const first = await queue.enqueue("reflectie", { dynimoId: 1, sleeping: true }, { deduplication: { id: "reflectie:1" } });
    await new Promise((resolve) => setTimeout(resolve, 150)); // laat de worker de eerste job oppikken
    await queue.enqueue("reflectie", { dynimoId: 1, sleeping: true }, { deduplication: { id: "reflectie:1" } });
    release();
    await first.waitUntilFinished(queueEvents);
    await new Promise((resolve) => setTimeout(resolve, 150)); // een eventuele tweede uitvoering de kans geven

    expect(calls).toBe(1);
  });

  it("scheduleBackfill plant per Dynimo-id een backfill-job in met een eigen dedup-id (#127)", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await scheduleBackfill({ enqueue }, [3, 7]);

    expect(enqueue).toHaveBeenNthCalledWith(1, "backfill", { dynimoId: 3 }, { deduplication: { id: "backfill:3" } });
    expect(enqueue).toHaveBeenNthCalledWith(2, "backfill", { dynimoId: 7 }, { deduplication: { id: "backfill:7" } });
  });
});
