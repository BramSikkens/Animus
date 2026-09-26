import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import { Redis as IORedis } from "ioredis";

export const QUEUE_NAME = "animus";

// ponytail: "ping" is het enige jobtype, puur om de wachtrij-fundering (queue, worker, retries) te bewijzen.
// De echte jobs (reflectie, herinnering, backfill) volgen in #125–#127; dit type verdwijnt/wordt dan aangevuld.
export type JobPayloads = { ping: { value: number } };

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
};

function connect(connection: string): IORedis {
  return new IORedis(connection, { maxRetriesPerRequest: null });
}

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

  return {
    async close(): Promise<void> {
      await worker.close();
      await redis.quit();
    },
  };
}
