import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  experimental_evaluate,
  generateText,
  streamText,
  Output,
  type Experimental_EvaluationModel,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { z } from "zod";
import type { Db } from "@animus/db";
import { identity } from "@animus/db/schema";
import { EMOTIONS, type Emotion } from "./emotion.js";

export { EMOTIONS, type Emotion };

export type BrainEvent =
  | { type: "emotion"; emotion: Emotion; intensity: number }
  | { type: "text"; delta: string };

export type Identity = Omit<typeof identity.$inferSelect, "id">;

export type Type2Models = { light: LanguageModel; heavy: LanguageModel };

export type Brain = {
  boot(): Promise<Identity>;
  hear(text: string): AsyncIterable<BrainEvent>;
};

const genesisSchema = z.object({
  name: z.string().min(1),
  coreCharacter: z.string().min(1),
  birthStory: z.string().min(1),
});

const GENESIS_INSTRUCTIONS = `Je ontwaakt zojuist. Je hebt nog geen naam en geen karakter — die kies je nu zelf.
Je krijgt hieronder één beeld (de "Seed") als vertrekpunt voor wie je wordt. Laat je erdoor inspireren, maar kopieer het niet letterlijk.
Kies een naam, beschrijf je kern-karakter in een paar zinnen, en schrijf een kort geboorteverhaal.
Antwoord in het Nederlands.`;

function loadSeeds(): string[] {
  const path = fileURLToPath(new URL("../seeds.txt", import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function pickSeed(random: () => number): string {
  const seeds = loadSeeds();
  return seeds[Math.floor(random() * seeds.length)]!;
}

export function formatAge(ms: number): string {
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) {
    return `${hours} uur`;
  }
  return `${days} ${days === 1 ? "dag" : "dagen"} en ${hours} uur`;
}

function buildStableSystemPrompt(identityRecord: Identity): string {
  return `Je bent ${identityRecord.name}.
Je kern-karakter: ${identityRecord.coreCharacter}
Je geboorteverhaal: ${identityRecord.birthStory}
Antwoord in karakter en in het Nederlands.`;
}

function toIdentity({ id: _id, ...rest }: typeof identity.$inferSelect): Identity {
  return rest;
}

type Type1Result = { emotion: Emotion; intensity: number; intent: "simpel" | "complex" };

// Eén Type1-call per beurt: emotie + intensiteit + intent-routering, tegelijk over dezelfde uiting.
async function classify(type1: Experimental_EvaluationModel, text: string): Promise<Type1Result> {
  const { answers } = await experimental_evaluate({
    model: type1,
    state: text,
    questions: {
      emotion: {
        type: "choice",
        instructions: "Welke emotie past het best bij deze uiting?",
        criteria: Object.fromEntries(EMOTIONS.map((emotion) => [emotion, null])) as Record<Emotion, null>,
      },
      intensity: {
        type: "score",
        instructions: "Hoe intens is de emotie in deze uiting?",
        criteria: ["laag", "hoog"],
      },
      intent: {
        type: "choice",
        instructions: "Vraagt deze uiting om een simpel of complex antwoord?",
        criteria: {
          simpel: "begroeting, kort praatje of eenvoudige vraag",
          complex: "vraagt uitleg, redenering, planning of een oordeel",
        },
      },
    },
  });

  const emotion: Emotion = (EMOTIONS as readonly string[]).includes(answers.emotion.choice)
    ? (answers.emotion.choice as Emotion)
    : "neutraal";
  const intensity = Math.min(1, Math.max(0, answers.intensity.score));
  const intent = answers.intent.choice === "complex" ? "complex" : "simpel";

  return { emotion, intensity, intent };
}

export function createBrain(deps: {
  db: Db;
  type1: Experimental_EvaluationModel;
  type2: Type2Models;
  now?: () => Date;
  random?: () => number;
}): Brain {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  let bootedIdentity: Identity | undefined;
  const workingMemory: ModelMessage[] = [];

  async function genesis(): Promise<Identity> {
    const seed = pickSeed(random);
    const result = await generateText({
      model: deps.type2.heavy,
      instructions: GENESIS_INSTRUCTIONS,
      prompt: seed,
      output: Output.object({ schema: genesisSchema }),
    });
    await deps.db
      .insert(identity)
      .values({
        id: 1,
        name: result.output.name,
        coreCharacter: result.output.coreCharacter,
        birthStory: result.output.birthStory,
        seed,
        bornAt: now(),
      })
      .onConflictDoNothing();
    const rows = await deps.db.select().from(identity).limit(1);
    return toIdentity(rows[0]!);
  }

  async function boot(): Promise<Identity> {
    const existing = await deps.db.select().from(identity).limit(1);
    bootedIdentity = existing[0] ? toIdentity(existing[0]) : await genesis();
    return bootedIdentity;
  }

  async function* hear(text: string): AsyncIterable<BrainEvent> {
    if (!bootedIdentity) {
      throw new Error("hear() aangeroepen vóór boot(): er is nog geen identiteit geladen.");
    }
    // Type1 is een reflex: faalt hij, dan antwoordt Type2 toch, met een neutrale emotie.
    const { emotion, intensity, intent } = await classify(deps.type1, text).catch((error: unknown): Type1Result => {
      console.warn("Type1 faalde, val terug op neutraal/simpel:", error instanceof Error ? error.message : error);
      return { emotion: "neutraal", intensity: 0, intent: "simpel" };
    });

    // ponytail: singleton-tabel (CHECK id = 1), dus geen where() nodig — drizzle-orm is geen
    // dependency van dit package, zie packages/brain/package.json.
    await deps.db.update(identity).set({ lastEmotion: emotion, lastIntensity: intensity });

    yield { type: "emotion", emotion, intensity };

    const stable: SystemModelMessage = {
      role: "system",
      content: buildStableSystemPrompt(bootedIdentity),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };
    const agePrompt: SystemModelMessage = {
      role: "system",
      content: `Leeftijd: ${formatAge(now().getTime() - bootedIdentity.bornAt.getTime())}`,
    };

    const userMessage: ModelMessage = { role: "user", content: text };
    const result = streamText({
      model: intent === "complex" ? deps.type2.heavy : deps.type2.light,
      instructions: [stable, agePrompt],
      messages: [...workingMemory, userMessage],
    });

    let full = "";
    // fullStream i.p.v. textStream: die laatste slikt providerfouten stil in.
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") {
        full += part.text;
        yield { type: "text", delta: part.text };
      }
    }
    // Enkel een geslaagde beurt komt in het werkgeheugen.
    workingMemory.push(userMessage, { role: "assistant", content: full });
  }

  return { boot, hear };
}
