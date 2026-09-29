import { fileURLToPath } from "node:url";
import { createDb } from "@animus/db";
import { createAnimus } from "@animus/core";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "@animus/core/config";
import { createJobQueue, type JobsDep } from "@animus/core/jobs";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

export function openDb(): ReturnType<typeof createDb> {
  return createDb(process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus");
}

export function openJobQueue(): ReturnType<typeof createJobQueue> {
  return createJobQueue({ connection: process.env.REDIS_URL ?? "redis://localhost:6379" });
}

export function openAnimus(db: Parameters<typeof createAnimus>[0]["db"], jobs?: JobsDep): ReturnType<typeof createAnimus> {
  return createAnimus({ db, type1: TYPE1_MODEL, type2: loadType2Config(), type2Catalog: type2Catalog(), embedder: EMBEDDING_MODEL, jobs });
}
