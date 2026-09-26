import { fileURLToPath } from "node:url";
import { isNotNull } from "drizzle-orm";
import { createDb, migrate } from "@animus/db";
import { dynimos } from "@animus/db/schema";
import { createBrain } from "./index.js";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "./config.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

// Bij het opstarten van Animus (`pnpm dev`) slapen alle Dynimo's: wekken doet de gebruiker via het dashboard.
async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus");
  try {
    await migrate(db);
    try {
      // Via de brain: de vorige wakkere Dynimo krijgt zo zijn Reflectie voor het slapen.
      const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), type2Catalog: type2Catalog(), embedder: EMBEDDING_MODEL });
      await brain.sleep();
    } catch (error) {
      // Geen modelconfig (of de call faalde): dev mag nooit breken, dus terugval op direct slapen zonder Reflectie.
      console.warn(`Slapen via de brain mislukte (${error instanceof Error ? error.message : error}); direct slapen zonder Reflectie.`);
    }
    // Idempotent vangnet: ook na een geslaagde brain.sleep() staat niemand meer wakker.
    await db.update(dynimos).set({ awakeSince: null }).where(isNotNull(dynimos.awakeSince));
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
