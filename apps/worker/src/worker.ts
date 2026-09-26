import { fileURLToPath } from "node:url";
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

import { startWorker } from "@animus/brain/jobs";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// ponytail: nog geen handlers, dus nog geen brain-instantie nodig — #125 voegt die toe zodra de eerste
// echte job (reflectie/herinnering/backfill) een brain nodig heeft.
const worker = startWorker({ connection: redisUrl, handlers: {} });

console.log("[worker] klaar");

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
