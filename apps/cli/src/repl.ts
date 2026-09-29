import { openBrain, openDb, openJobQueue } from "./bootstrap.js";
import { createInterface } from "node:readline/promises";
import { migrate } from "@animus/db";
import { formatAge } from "@animus/brain";

async function main(): Promise<void> {
  const db = openDb();
  await migrate(db);

  // Reflectie via de wachtrij (#125): enkel inplannen, de worker voert 'm uit.
  const jobs = openJobQueue();
  const brain = openBrain(db, jobs);
  const awake = (await brain.list()).find((dynimo) => dynimo.awakeSince);

  if (awake) {
    console.log(`Je praat met ${awake.name}.`);
    console.log(`Leeftijd: ${formatAge(Date.now() - awake.bornAt.getTime())}`);
  } else {
    console.log("Niemand is wakker — wek een Dynimo via het dashboard.");
  }
  console.log("Typ een zin en druk op enter. Ctrl+C om te stoppen.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.prompt();
  // Eindigt bij EOF (Ctrl+D of gepipete input).
  for await (const line of rl) {
    if (line.trim()) {
      // Het dashboard kan intussen een andere Dynimo wekken: de naam elke regel opnieuw ophalen.
      const name = (await brain.list()).find((dynimo) => dynimo.awakeSince)?.name;
      let heard = false;
      for await (const event of brain.hear(line)) {
        heard = true;
        if (event.type === "mood") {
          process.stdout.write(`(${event.emotion} ${event.intensity.toFixed(2)}) ${name}: `);
        } else if (event.type === "text") {
          process.stdout.write(event.delta);
        } else if (event.type === "tool-call") {
          process.stdout.write(`[tool: ${event.toolName}] `);
        } // tool-result bewust niet getoond: Type2 verwoordt het resultaat zelf.
      }
      process.stdout.write(heard ? "\n" : "(niemand wakker)\n");
    }
    rl.prompt();
  }
  await brain.settled();
  await jobs.close();
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
