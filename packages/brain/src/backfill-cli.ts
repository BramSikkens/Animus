import { fileURLToPath } from "node:url";
import { createDb, migrate } from "@animus/db";
import { createBrain } from "./index.js";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "./config.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

// Bij het opstarten van Animus (`pnpm dev`): bestaande Dynimo's krijgen alle eigenschappen die ze nog missen.
// Bewust niet-fataal: een fout hier (bv. ontbrekende model-env-vars) mag `pnpm dev` niet laten stoppen.
async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus");
  try {
    await migrate(db);
    const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), type2Catalog: type2Catalog(), embedder: EMBEDDING_MODEL });
    console.log(`Backfill: ${await brain.backfill()} Dynimo(s) bijgewerkt.`);
  } catch (error) {
    console.warn(
      `Backfill overgeslagen: ${error instanceof Error ? error.message : error}\n` +
        "Ontbrekende eigenschappen worden bij de volgende start opnieuw geprobeerd.",
    );
  } finally {
    await db.$client.end();
  }
}

await main();
