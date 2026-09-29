import { openAnimus, openDb, openJobQueue } from "./bootstrap.js";
import { isNotNull } from "drizzle-orm";
import { migrate } from "@animus/db";
import { dynimos } from "@animus/db/schema";

// Bij het opstarten van Animus (`pnpm dev`) slapen alle Dynimo's: wekken doet de gebruiker via het dashboard.
async function main(): Promise<void> {
  const db = openDb();
  // Reflectie via de wachtrij (#125): enkel inplannen, de worker voert 'm uit.
  const jobs = openJobQueue();
  try {
    await migrate(db);
    try {
      // Via de Animus: de vorige wakkere Dynimo krijgt zo zijn Reflectie voor het slapen.
      const animus = openAnimus(db, jobs);
      await animus.sleep();
    } catch (error) {
      // Geen modelconfig (of de call faalde): dev mag nooit breken, dus terugval op direct slapen zonder Reflectie.
      console.warn(`Slapen via de Animus mislukte (${error instanceof Error ? error.message : error}); direct slapen zonder Reflectie.`);
    }
    // Idempotent vangnet: ook na een geslaagde animus.sleep() staat niemand meer wakker.
    await db.update(dynimos).set({ awakeSince: null }).where(isNotNull(dynimos.awakeSince));
  } finally {
    await jobs.close();
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
