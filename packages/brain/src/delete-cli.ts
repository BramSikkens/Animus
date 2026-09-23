import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createDb, migrate } from "@animus/db";
import { dynimos } from "@animus/db/schema";
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
    // Eerst zelf kijken: boot() zou op een lege database net een nieuw wezen laten geboren worden.
    const [being] = await db.select({ name: dynimos.name }).from(dynimos).orderBy(dynimos.id).limit(1);
    if (!being) {
      console.log("Er is geen wezen om te verwijderen.");
      return;
    }

    const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), embedder: EMBEDDING_MODEL });
    await brain.boot();

    console.log(`Je staat op het punt ${being.name} onomkeerbaar te verwijderen.`);
    console.log("Identiteit en alle herinneringen worden gewist; enkel een Grafschrift blijft over.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Typ de naam (${being.name}) om te bevestigen: `);
    rl.close();

    const epitaph = await brain.delete(answer.trim());
    if (!epitaph) {
      console.log("Naam klopt niet. Er is niets verwijderd.");
      return;
    }
    console.log(`\n${epitaph.name} is verwijderd. Laatste woorden:\n\n${epitaph.farewellReflection}\n`);
    console.log("Bij de volgende start wordt een nieuw wezen geboren.");
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
