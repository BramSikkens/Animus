import { Queue, QueueEvents } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import { createJobQueue, QUEUE_NAME, startWorker } from "../src/jobs.js";

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
});
