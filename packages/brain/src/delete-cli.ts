import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createDb, migrate } from "@animus/db";
import { createBrain } from "./index.js";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL } from "./config.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}

async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus");
  await migrate(db);
  try {
    const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), embedder: EMBEDDING_MODEL });
    const dynimos = await brain.list();
    if (dynimos.length === 0) {
      console.log("Er is geen Dynimo om te doden.");
      return;
    }

    console.log("Levende Dynimo's:");
    for (const dynimo of dynimos) console.log(`- ${dynimo.name}${dynimo.awakeSince ? " (wakker)" : ""}`);
    console.log("\nIdentiteit en alle herinneringen van de gekozen Dynimo worden onomkeerbaar gewist; enkel een Grafschrift blijft over.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Typ de exacte naam van de Dynimo om te doden: ")).trim();
    rl.close();

    const target = dynimos.find((dynimo) => dynimo.name === answer);
    const epitaph = target && (await brain.kill(target.id, answer));
    if (!epitaph) {
      console.log("Naam klopt niet. Er is niets verwijderd.");
      return;
    }
    console.log(`\n${epitaph.name} is verwijderd. Laatste woorden:\n\n${epitaph.farewellReflection}\n`);
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
