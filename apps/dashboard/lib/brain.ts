import { createBrain, defaultVoiceDeps, type Brain } from "@animus/brain";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "@animus/brain/config";
import { createJobQueue } from "@animus/brain/jobs";
import { db } from "./db";

const globalForBrain = globalThis as unknown as { animusBrain?: Brain; animusJobs?: ReturnType<typeof createJobQueue> };

// Reflectie via de wachtrij (#125): de dashboard-actie "slapen" plant enkel in, de worker voert uit.
function getJobs(): ReturnType<typeof createJobQueue> {
  return (globalForBrain.animusJobs ??= createJobQueue({ connection: process.env.REDIS_URL ?? "redis://localhost:6379" }));
}

// Lazy: loadType2Config() gooit bij ontbrekende env-vars, en de pagina moet ook zonder die vars laden.
export function getBrain(): Brain {
  return (globalForBrain.animusBrain ??= createBrain({
    db,
    type1: TYPE1_MODEL,
    type2: loadType2Config(),
    type2Catalog: type2Catalog(),
    embedder: EMBEDDING_MODEL,
    voices: defaultVoiceDeps(process.env),
    jobs: getJobs(),
  }));
}
