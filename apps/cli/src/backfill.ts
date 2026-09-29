import { openAnimus, openDb, openJobQueue } from "./bootstrap.js";
import { migrate } from "@animus/db";
import { scheduleBackfill } from "@animus/core/jobs";

const direct = process.argv.includes("--direct");

// Bestaande Dynimo's krijgen alle eigenschappen die ze nog missen. Standaard (#127): per Dynimo een `backfill`-job
// inplannen, de worker voert 'm uit (met retries). Met `--direct`: zoals voorheen synchroon draaien, zonder worker.
// Bewust niet-fataal: een fout hier (bv. ontbrekende model-env-vars, of geen bereikbare Redis) mag `pnpm dev` niet
// laten stoppen.
async function main(): Promise<void> {
  const db = openDb();
  try {
    await migrate(db);
    const animus = openAnimus(db);
    if (direct) {
      console.log(`Backfill: ${await animus.backfill()} Dynimo(s) bijgewerkt.`);
      return;
    }
    const ids = (await animus.list()).map((dynimo) => dynimo.id);
    const queue = openJobQueue();
    try {
      await scheduleBackfill(queue, ids);
      console.log(`Backfill: ${ids.length} Dynimo('s) ingepland.`);
    } finally {
      await queue.close();
    }
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
