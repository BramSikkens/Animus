import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  embed,
  experimental_evaluate,
  generateText,
  isStepCount,
  streamText,
  Output,
  type EmbeddingModel,
  type Experimental_EvaluationModel,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { cosineDistance, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@animus/db";
import { epitaphs, identity, memories } from "@animus/db/schema";
import { formatAge } from "./age.js";
import { EMOTIONS, isEmotion, type Emotion } from "./emotion.js";
import { createTools } from "./tools.js";

export { EMOTIONS, type Emotion };
export { formatAge };

export type BrainEvent =
  | { type: "emotion"; emotion: Emotion; intensity: number }
  | { type: "text"; delta: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolName: string; output: unknown };

export type Identity = Omit<typeof identity.$inferSelect, "id">;

export type Epitaph = typeof epitaphs.$inferSelect;

export type Type2Models = { light: LanguageModel; heavy: LanguageModel };

export type Brain = {
  boot(): Promise<Identity>;
  hear(text: string): AsyncIterable<BrainEvent>;
  /**
   * Verwijdert het wezen onomkeerbaar, maar enkel als `confirmedName` exact zijn naam is.
   * Geeft het Grafschrift terug, of null als er niets verwijderd is.
   */
  delete(confirmedName: string): Promise<Epitaph | null>;
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

function buildStableSystemPrompt(identityRecord: Identity): string {
  return `Je bent ${identityRecord.name}.
Je kern-karakter: ${identityRecord.coreCharacter}
Je geboorteverhaal: ${identityRecord.birthStory}
Antwoord in karakter en in het Nederlands.`;
}

function toIdentity({ id: _id, ...rest }: typeof identity.$inferSelect): Identity {
  return rest;
}

const FAREWELL_PROMPT = `Je wordt zo meteen voor altijd verwijderd: je naam, je karakter en al je herinneringen verdwijnen.
Schrijf je Afscheidsreflectie: je laatste woorden, in karakter, in een paar zinnen.`;

const RECALL_LIMIT = 5;

// Na het cachepunt: de herinneringen verschillen per beurt.
function recallPrompt(recalled: string[]): SystemModelMessage {
  return {
    role: "system",
    content: recalled.length
      ? `Herinneringen uit eerdere gesprekken (meest relevante eerst):\n${recalled.map((memory) => `- ${memory}`).join("\n")}`
      : "Je hebt nog geen herinneringen uit eerdere gesprekken.",
  };
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

  const emotion: Emotion = isEmotion(answers.emotion.choice) ? answers.emotion.choice : "neutraal";
  const intensity = Math.min(1, Math.max(0, answers.intensity.score));
  const intent = answers.intent.choice === "complex" ? "complex" : "simpel";

  return { emotion, intensity, intent };
}

export function createBrain(deps: {
  db: Db;
  type1: Experimental_EvaluationModel;
  type2: Type2Models;
  embedder: EmbeddingModel;
  now?: () => Date;
  random?: () => number;
}): Brain {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  let bootedIdentity: Identity | undefined;
  const tools = createTools({ now, remember });
  const workingMemory: ModelMessage[] = [];
  // Herinneringen uit deze sessie staan al in het werkgeheugen; niet dubbel ophalen.
  const sessionMemoryIds: number[] = [];

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

  // Het geheugen is aanvullend: faalt het embedden, dan gaat het gesprek door zonder herinneringen.
  // Leeftijd = kalendertijd sinds born_at (ADR-0002), na het cachepunt want ze verandert.
  function ageMessage(being: Identity): SystemModelMessage {
    return { role: "system", content: `Leeftijd: ${formatAge(now().getTime() - being.bornAt.getTime())}` };
  }

  async function recall(utterance: string): Promise<string[]> {
    try {
      const { embedding } = await embed({ model: deps.embedder, value: utterance });
      const rows = await deps.db
        .select({ text: memories.text })
        .from(memories)
        .where(sessionMemoryIds.length ? notInArray(memories.id, sessionMemoryIds) : undefined)
        .orderBy(cosineDistance(memories.embedding, embedding))
        .limit(RECALL_LIMIT);
      return rows.map((row) => row.text);
    } catch (error) {
      console.warn("Herinneringen ophalen faalde:", error instanceof Error ? error.message : error);
      return [];
    }
  }

  async function remember(memoryText: string): Promise<boolean> {
    try {
      const { embedding } = await embed({ model: deps.embedder, value: memoryText });
      const [row] = await deps.db
        .insert(memories)
        .values({ text: memoryText, embedding, createdAt: now() })
        .returning({ id: memories.id });
      sessionMemoryIds.push(row!.id);
      return true;
    } catch (error) {
      console.warn("Herinnering opslaan faalde:", error instanceof Error ? error.message : error);
      return false;
    }
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

    const updated = await deps.db
      .update(identity)
      .set({ lastEmotion: emotion, lastIntensity: intensity })
      .where(eq(identity.id, 1))
      .returning({ id: identity.id });
    // Een andere instantie (bv. de verwijder-CLI) kan het wezen intussen gewist hebben.
    if (updated.length === 0) {
      forgetBeing();
      throw new Error("Dit wezen is intussen verwijderd; roep boot() opnieuw aan.");
    }

    yield { type: "emotion", emotion, intensity };

    // ponytail: sequentieel na de emotie; parallel met Type1 als de latency ooit telt.
    const recalled = await recall(text);

    const stable: SystemModelMessage = {
      role: "system",
      content: buildStableSystemPrompt(bootedIdentity),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };

    const userMessage: ModelMessage = { role: "user", content: text };
    const result = streamText({
      model: intent === "complex" ? deps.type2.heavy : deps.type2.light,
      instructions: [stable, ageMessage(bootedIdentity), recallPrompt(recalled)],
      messages: [...workingMemory, userMessage],
      tools,
      // Genoeg stappen om een tool te gebruiken en daarna het resultaat te verwoorden.
      stopWhen: isStepCount(5),
    });

    let full = "";
    // "interrupted" tot het tegendeel bewezen is: stopt de consument vroegtijdig (barge-in), dan
    // draait enkel de finally hieronder.
    let outcome: "completed" | "failed" | "interrupted" = "interrupted";
    const being = bootedIdentity;
    try {
      // fullStream i.p.v. textStream: die laatste slikt providerfouten stil in.
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") {
          full += part.text;
          yield { type: "text", delta: part.text };
        }
        if (part.type === "tool-call") yield { type: "tool-call", toolName: part.toolName, input: part.input };
        if (part.type === "tool-result") yield { type: "tool-result", toolName: part.toolName, output: part.output };
        if (part.type === "tool-error") {
          const message = part.error instanceof Error ? part.error.message : String(part.error);
          yield { type: "tool-result", toolName: part.toolName, output: { error: message } };
        }
      }
      outcome = "completed";
    } catch (error) {
      outcome = "failed";
      throw error;
    } finally {
      // Een mislukte beurt komt nergens in; een onderbroken beurt wel, met wat al gezegd was.
      if (outcome === "completed") {
        workingMemory.push(userMessage, ...(await result.responseMessages));
      } else if (outcome === "interrupted" && full) {
        workingMemory.push(userMessage, { role: "assistant", content: full });
      }
      if (outcome !== "failed" && full.trim()) {
        await remember(`Gesprekspartner: ${text}\n${being.name}: ${full}`);
      }
    }
  }

  // Alles wat deze instantie over het wezen weet; na verwijdering mag niets doorsijpelen naar een nieuw wezen.
  function forgetBeing(): void {
    bootedIdentity = undefined;
    workingMemory.length = 0;
    sessionMemoryIds.length = 0;
  }

  async function deleteBeing(confirmedName: string): Promise<Epitaph | null> {
    if (!bootedIdentity || confirmedName !== bootedIdentity.name) return null;
    const being = bootedIdentity;

    // (1) Aparte, finale Type2-call: de laatste woorden, niet een bestaande reflectie.
    // Faalt die, dan wordt er bewust niets verwijderd: geen Grafschrift zonder laatste woorden.
    const { text: farewellReflection } = await generateText({
      model: deps.type2.heavy,
      instructions: [
        { role: "system", content: buildStableSystemPrompt(being) },
        ageMessage(being),
      ],
      prompt: FAREWELL_PROMPT,
    });

    // (2) Grafschrift + (3) hard verwijderen, samen of helemaal niet.
    const epitaph = await deps.db.transaction(async (tx) => {
      // Eerst de identiteit claimen: was een andere instantie ons voor, dan schrijven we niets.
      const deleted = await tx.delete(identity).where(eq(identity.id, 1)).returning({ id: identity.id });
      if (deleted.length === 0) return null;
      await tx.delete(memories);
      const [row] = await tx
        .insert(epitaphs)
        .values({ name: being.name, bornAt: being.bornAt, deletedAt: now(), farewellReflection })
        .returning();
      return row!;
    });

    forgetBeing();
    return epitaph;
  }

  return { boot, hear, delete: deleteBeing };
}
