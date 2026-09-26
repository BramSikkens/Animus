import { fileURLToPath } from "node:url";
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

import { createBrain } from "@animus/brain";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "@animus/brain/config";
import { createJobQueue, scheduleBackfill, startWorker } from "@animus/brain/jobs";
import { createDb, migrate } from "@animus/db";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const databaseUrl = process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus";

const db = createDb(databaseUrl);
await migrate(db);

// Geen `jobs`-dep hier (#125): de worker voért de reflectie-jobs zelf uit i.p.v. ze in te plannen.
const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), type2Catalog: type2Catalog(), embedder: EMBEDDING_MODEL });

const worker = startWorker({
  connection: redisUrl,
  handlers: {
    reflectie: (payload) => brain.runReflection(payload.dynimoId, payload),
    herinnering: (payload) => brain.storeMemory(payload),
    backfill: (payload) => brain.backfillDynimo(payload.dynimoId),
  },
});

console.log("[worker] klaar");

// Backfill als job (#127): bij het opstarten voor elke bestaande Dynimo één inplannen, i.p.v. synchroon vóór
// `pnpm dev` z'n apps. Eigen queue (niet gedeeld met de worker hierboven), gesloten bij shutdown. Niet-fataal:
// een fout hier mag de worker niet laten stoppen (zelfde afweging als de oude backfill-cli).
const backfillQueue = createJobQueue({ connection: redisUrl });
try {
  await scheduleBackfill(backfillQueue, (await brain.list()).map((dynimo) => dynimo.id));
} catch (error) {
  console.warn("Backfill inplannen overgeslagen:", error instanceof Error ? error.message : error);
}

async function shutdown(): Promise<void> {
  await worker.close();
  await backfillQueue.close();
  await db.$client.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
