import { createAnimus, defaultVoiceDeps, type Animus } from "@animus/core";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "@animus/core/config";
import { createJobQueue } from "@animus/core/jobs";
import { db } from "./db";

const globalForAnimus = globalThis as unknown as { animus?: Animus; animusJobs?: ReturnType<typeof createJobQueue> };

// Reflectie via de wachtrij (#125): de dashboard-actie "slapen" plant enkel in, de worker voert uit.
function getJobs(): ReturnType<typeof createJobQueue> {
  return (globalForAnimus.animusJobs ??= createJobQueue({ connection: process.env.REDIS_URL ?? "redis://localhost:6379" }));
}

// Lazy: loadType2Config() gooit bij ontbrekende env-vars, en de pagina moet ook zonder die vars laden.
export function getAnimus(): Animus {
  return (globalForAnimus.animus ??= createAnimus({
    db,
    type1: TYPE1_MODEL,
    type2: loadType2Config(),
    type2Catalog: type2Catalog(),
    embedder: EMBEDDING_MODEL,
    voices: defaultVoiceDeps(process.env),
    jobs: getJobs(),
  }));
}
