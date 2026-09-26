import { createBrain, defaultVoiceDeps, type Brain } from "@animus/brain";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "@animus/brain/config";
import { db } from "./db";

const globalForBrain = globalThis as unknown as { animusBrain?: Brain };

// Lazy: loadType2Config() gooit bij ontbrekende env-vars, en de pagina moet ook zonder die vars laden.
export function getBrain(): Brain {
  return (globalForBrain.animusBrain ??= createBrain({
    db,
    type1: TYPE1_MODEL,
    type2: loadType2Config(),
    type2Catalog: type2Catalog(),
    embedder: EMBEDDING_MODEL,
    voices: defaultVoiceDeps(process.env),
  }));
}
