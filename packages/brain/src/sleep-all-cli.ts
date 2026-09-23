import { fileURLToPath } from "node:url";
import { isNotNull } from "drizzle-orm";
import { createDb, migrate } from "@animus/db";
import { dynimos } from "@animus/db/schema";

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
    // Direct i.p.v. brain.sleep(): geen modelconfig nodig; herzien zodra slapen een Reflectie triggert (#27).
    await db.update(dynimos).set({ awakeSince: null }).where(isNotNull(dynimos.awakeSince));
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
