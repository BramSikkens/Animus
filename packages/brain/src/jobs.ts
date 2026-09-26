import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import { Redis as IORedis } from "ioredis";

export const QUEUE_NAME = "animus";

// ponytail: "ping" blijft naast de echte jobs staan, puur om de wachtrij-fundering (queue, worker, retries) te
// bewijzen in jobs.test.ts. Herinnering/backfill volgen in #126–#127.
export type JobPayloads = {
  ping: { value: number };
  /** Reflectie van één Dynimo (#125): bij slapen/wisselen (sleeping: true) of bij stilte (sleeping: false). */
  reflectie: { dynimoId: number; sleeping: boolean; aanwezig?: number[] };
};

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
};

function connect(connection: string): IORedis {
  return new IORedis(connection, { maxRetriesPerRequest: null });
}

/** Enkel `enqueue`, zoals `createBrain`'s `jobs`-dep hem gebruikt (inplannen, nooit de queue zelf beheren). */
export type JobEnqueue = ReturnType<typeof createJobQueue>["enqueue"];

export function createJobQueue({ connection, prefix }: { connection: string; prefix?: string }) {
  const redis = connect(connection);
  const queue = new Queue<JobPayloads[keyof JobPayloads]>(QUEUE_NAME, { connection: redis, prefix });

  return {
    async enqueue<K extends keyof JobPayloads>(
      name: K,
      payload: JobPayloads[K],
      opts?: Partial<JobsOptions>,
    ): Promise<Job> {
      return queue.add(name, payload, { ...DEFAULT_JOB_OPTIONS, ...opts });
    },
    async close(): Promise<void> {
      await queue.close();
      await redis.quit();
    },
  };
}

export function startWorker({
  connection,
  prefix,
  handlers,
}: {
  connection: string;
  prefix?: string;
  handlers: Partial<{ [K in keyof JobPayloads]: (payload: JobPayloads[K]) => Promise<unknown> }>;
}) {
  const redis = connect(connection);
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = handlers[job.name as keyof JobPayloads];
      if (!handler) throw new Error(`Geen handler voor job "${job.name}"`);
      return handler(job.data);
    },
    { connection: redis, prefix },
  );

  // Definitief gefaald (geen pogingen meer over): loggen, verder breekt niets (ADR-0022).
  worker.on("failed", (job, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    console.warn(`Job "${job.name}" (${job.id}) definitief mislukt:`, error instanceof Error ? error.message : error);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
      await redis.quit();
    },
  };
}
