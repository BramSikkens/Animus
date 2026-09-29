import { openAnimus, openDb } from "./bootstrap.js";
import { createInterface } from "node:readline/promises";
import { migrate } from "@animus/db";

async function main(): Promise<void> {
  const db = openDb();
  await migrate(db);
  try {
    const animus = openAnimus(db);
    const dynimos = await animus.list();
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
    const epitaph = target && (await animus.kill(target.id, answer));
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
