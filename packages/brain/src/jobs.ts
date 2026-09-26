import { Queue, QueueEvents, Worker, type Job, type JobsOptions } from "bullmq";
import { Redis as IORedis } from "ioredis";

export const QUEUE_NAME = "animus";

// ponytail: "ping" blijft naast de echte jobs staan, puur om de wachtrij-fundering (queue, worker, retries) te
// bewijzen in jobs.test.ts. Backfill volgt in #127.
export type JobPayloads = {
  ping: { value: number };
  /** Reflectie van één Dynimo (#125): bij slapen/wisselen (sleeping: true) of bij stilte (sleeping: false). */
  reflectie: { dynimoId: number; sleeping: boolean; aanwezig?: number[] };
  /** Herinnering opslaan (#126): dezelfde velden als storeMemory() nodig heeft; model idem #123. */
  herinnering: { dynimoId: number; personId: number | null; text: string; impression: number; model: string | null };
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

/** Wat `createBrain`'s `jobs`-dep nodig heeft (#126): inplannen, en op een resultaat wachten. */
export type JobsDep = Pick<ReturnType<typeof createJobQueue>, "enqueue" | "finished">;

export function createJobQueue({ connection, prefix }: { connection: string; prefix?: string }) {
  const redis = connect(connection);
  const queue = new Queue<JobPayloads[keyof JobPayloads]>(QUEUE_NAME, { connection: redis, prefix });
  // Lui aangemaakt: enkel nodig zodra iets op een job wacht (finished()); reflectie-jobs doen dat nooit. Eigen
  // connectie (niet de gedeelde `redis` hierboven): QueueEvents blokkeert op XREAD, dat zou queue.add() ophouden.
  let queueEvents: QueueEvents | undefined;
  function events(): QueueEvents {
    queueEvents ??= new QueueEvents(QUEUE_NAME, { connection: { url: connection }, prefix });
    return queueEvents;
  }

  return {
    async enqueue<K extends keyof JobPayloads>(
      name: K,
      payload: JobPayloads[K],
      opts?: Partial<JobsOptions>,
    ): Promise<Job> {
      return queue.add(name, payload, { ...DEFAULT_JOB_OPTIONS, ...opts });
    },
    /** Wacht op het resultaat van `job` (#126); gooit als de job definitief mislukt of `ttlMs` verstrijkt. */
    async finished(job: Job, ttlMs?: number): Promise<unknown> {
      return job.waitUntilFinished(events(), ttlMs);
    },
    async close(): Promise<void> {
      await queueEvents?.close();
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
