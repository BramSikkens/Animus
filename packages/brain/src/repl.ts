import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createDb, migrate } from "@animus/db";
import { createBrain, formatAge } from "./index.js";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL } from "./config.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus";
  const db = createDb(databaseUrl);
  await migrate(db);

  const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), embedder: EMBEDDING_MODEL });
  const identity = await brain.boot();

  console.log(`Je praat met ${identity.name}.`);
  console.log(`Leeftijd: ${formatAge(Date.now() - identity.bornAt.getTime())}`);
  console.log("Typ een zin en druk op enter. Ctrl+C om te stoppen.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.prompt();
  // Eindigt bij EOF (Ctrl+D of gepipete input).
  for await (const line of rl) {
    if (line.trim()) {
      for await (const event of brain.hear(line)) {
        if (event.type === "emotion") {
          process.stdout.write(`(${event.emotion} ${event.intensity.toFixed(2)}) ${identity.name}: `);
        } else {
          process.stdout.write(event.delta);
        }
      }
      process.stdout.write("\n");
    }
    rl.prompt();
  }
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
