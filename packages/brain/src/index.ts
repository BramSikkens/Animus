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
import { and, cosineDistance, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@animus/db";
import { dynimos, epitaphs, memories } from "@animus/db/schema";
import { formatAge } from "./age.js";
import { EMOTIONS, isEmotion, type Emotion } from "./emotion.js";
import { SEEDS } from "./seeds.js";
import { createTools } from "./tools.js";

export { EMOTIONS, type Emotion };
export { formatAge };

export type BrainEvent =
  | { type: "emotion"; emotion: Emotion; intensity: number }
  | { type: "text"; delta: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolName: string; output: unknown };

export type Dynimo = typeof dynimos.$inferSelect;

export type Epitaph = typeof epitaphs.$inferSelect;

export type Type2Models = { light: LanguageModel; heavy: LanguageModel };

export type Brain = {
  /** Laat een nieuwe Dynimo geboren worden (genesis); die is meteen Wakker, een eerder wakkere gaat slapen. */
  bringToLife(): Promise<Dynimo>;
  /** Wekt de Dynimo (een eventueel andere wakkere gaat slapen). Null bij een onbekende id. */
  wake(id: number): Promise<Dynimo | null>;
  /** Laat iedereen slapen. Idempotent. */
  sleep(): Promise<void>;
  /**
   * Doodt de Dynimo onomkeerbaar, maar enkel als `confirmedName` exact zijn naam is.
   * Geeft het Grafschrift terug, of null als er niets verwijderd is.
   */
  kill(id: number, confirmedName: string): Promise<Epitaph | null>;
  list(): Promise<Dynimo[]>;
  /** Praat met de Wakker Dynimo (elke beurt uit de database gelezen). Niemand wakker: geen events. */
  hear(text: string): AsyncIterable<BrainEvent>;
};

// Serialiseert alle wissels van Wakker/Slapend tussen instanties en processen.
const WAKE_LOCK_KEY = 7_142_001;

const genesisSchema = z.object({
  name: z.string().min(1),
  coreCharacter: z.string().min(1),
  birthStory: z.string().min(1),
});

const GENESIS_INSTRUCTIONS = `Je ontwaakt zojuist. Je hebt nog geen naam en geen karakter — die kies je nu zelf.
Je krijgt hieronder één beeld (de "Seed") als vertrekpunt voor wie je wordt. Laat je erdoor inspireren, maar kopieer het niet letterlijk.
Kies een naam, beschrijf je kern-karakter in een paar zinnen, en schrijf een kort geboorteverhaal.
Antwoord in het Nederlands.`;

function pickSeed(random: () => number): string {
  return SEEDS[Math.floor(random() * SEEDS.length)]!;
}

function buildStableSystemPrompt(identityRecord: Dynimo): string {
  return `Je bent ${identityRecord.name}.
Je kern-karakter: ${identityRecord.coreCharacter}
Je geboorteverhaal: ${identityRecord.birthStory}
Antwoord in karakter en in het Nederlands.`;
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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
  let current: Dynimo | undefined;
  const tools = createTools({ now, remember });
  const workingMemory: ModelMessage[] = [];
  // Herinneringen uit deze sessie staan al in het werkgeheugen; niet dubbel ophalen.
  const sessionMemoryIds: number[] = [];

  async function genesis(): Promise<typeof dynimos.$inferInsert> {
    const seed = pickSeed(random);
    const result = await generateText({
      model: deps.type2.heavy,
      instructions: GENESIS_INSTRUCTIONS,
      prompt: seed,
      output: Output.object({ schema: genesisSchema }),
    });
    return {
      name: result.output.name,
      coreCharacter: result.output.coreCharacter,
      birthStory: result.output.birthStory,
      seed,
      bornAt: now(),
    };
  }

  // Wissel van Wakker/Slapend onder de advisory lock: de partial unique index blijft dan nooit in de weg.
  function withWakeLock<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${WAKE_LOCK_KEY})`);
      return work(tx);
    });
  }

  function sleepAll(tx: Tx) {
    return tx.update(dynimos).set({ awakeSince: null }).where(isNotNull(dynimos.awakeSince));
  }

  // Een andere Wakker-generatie (andere Dynimo of nieuwe awake_since) is een nieuwe sessie.
  function adopt(row: Dynimo): Dynimo {
    if (current?.id !== row.id || current.awakeSince?.getTime() !== row.awakeSince?.getTime()) {
      workingMemory.length = 0;
      sessionMemoryIds.length = 0;
      current = row;
    }
    return current;
  }

  async function bringToLife(): Promise<Dynimo> {
    const values = await genesis();
    const row = await withWakeLock(async (tx) => {
      await sleepAll(tx);
      const [inserted] = await tx
        .insert(dynimos)
        .values({ ...values, awakeSince: now() })
        .returning();
      return inserted!;
    });
    return adopt(row);
  }

  async function wake(id: number): Promise<Dynimo | null> {
    const row = await withWakeLock(async (tx) => {
      const [found] = await tx.select().from(dynimos).where(eq(dynimos.id, id));
      if (!found || found.awakeSince) return found ?? null;
      await sleepAll(tx);
      const [woken] = await tx.update(dynimos).set({ awakeSince: now() }).where(eq(dynimos.id, id)).returning();
      return woken!;
    });
    return row && adopt(row);
  }

  async function sleep(): Promise<void> {
    await withWakeLock(sleepAll);
    forgetBeing();
  }

  async function list(): Promise<Dynimo[]> {
    return deps.db.select().from(dynimos).orderBy(dynimos.id);
  }

  // Het geheugen is aanvullend: faalt het embedden, dan gaat het gesprek door zonder herinneringen.
  // Leeftijd = kalendertijd sinds born_at (ADR-0002), na het cachepunt want ze verandert.
  function ageMessage(being: Dynimo): SystemModelMessage {
    return { role: "system", content: `Leeftijd: ${formatAge(now().getTime() - being.bornAt.getTime())}` };
  }

  async function recall(utterance: string, dynimoId: number): Promise<string[]> {
    try {
      const { embedding } = await embed({ model: deps.embedder, value: utterance });
      const scope = sessionMemoryIds.length
        ? and(eq(memories.dynimoId, dynimoId), notInArray(memories.id, sessionMemoryIds))
        : eq(memories.dynimoId, dynimoId);
      const rows = await deps.db
        .select({ text: memories.text })
        .from(memories)
        .where(scope)
        .orderBy(cosineDistance(memories.embedding, embedding))
        .limit(RECALL_LIMIT);
      return rows.map((row) => row.text);
    } catch (error) {
      console.warn("Herinneringen ophalen faalde:", error instanceof Error ? error.message : error);
      return [];
    }
  }

  async function remember(memoryText: string, dynimoId = current?.id): Promise<boolean> {
    if (dynimoId === undefined) return false;
    try {
      const { embedding } = await embed({ model: deps.embedder, value: memoryText });
      const [row] = await deps.db
        .insert(memories)
        .values({ dynimoId, text: memoryText, embedding, createdAt: now() })
        .returning({ id: memories.id });
      sessionMemoryIds.push(row!.id);
      return true;
    } catch (error) {
      console.warn("Herinnering opslaan faalde:", error instanceof Error ? error.message : error);
      return false;
    }
  }

  async function* hear(text: string): AsyncIterable<BrainEvent> {
    // Elke beurt opnieuw: een ander proces (dashboard) kan intussen wisselen van Wakker Dynimo.
    const [awake] = await deps.db.select().from(dynimos).where(isNotNull(dynimos.awakeSince));
    if (!awake) {
      forgetBeing();
      return;
    }
    const being = adopt(awake);
    // Type1 is een reflex: faalt hij, dan antwoordt Type2 toch, met een neutrale emotie.
    const { emotion, intensity, intent } = await classify(deps.type1, text).catch((error: unknown): Type1Result => {
      console.warn("Type1 faalde, val terug op neutraal/simpel:", error instanceof Error ? error.message : error);
      return { emotion: "neutraal", intensity: 0, intent: "simpel" };
    });

    const updated = await deps.db
      .update(dynimos)
      .set({ lastEmotion: emotion, lastIntensity: intensity })
      .where(eq(dynimos.id, being.id))
      .returning({ id: dynimos.id });
    // Een andere instantie kan de Dynimo intussen gedood hebben: dan is niemand wakker.
    if (updated.length === 0) {
      forgetBeing();
      return;
    }

    yield { type: "emotion", emotion, intensity };

    // ponytail: sequentieel na de emotie; parallel met Type1 als de latency ooit telt.
    const recalled = await recall(text, being.id);

    const stable: SystemModelMessage = {
      role: "system",
      content: buildStableSystemPrompt(being),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };

    const userMessage: ModelMessage = { role: "user", content: text };
    const result = streamText({
      model: intent === "complex" ? deps.type2.heavy : deps.type2.light,
      instructions: [stable, ageMessage(being), recallPrompt(recalled)],
      messages: [...workingMemory, userMessage],
      tools,
      // Genoeg stappen om een tool te gebruiken en daarna het resultaat te verwoorden.
      stopWhen: isStepCount(5),
    });

    let full = "";
    // "interrupted" tot het tegendeel bewezen is: stopt de consument vroegtijdig (barge-in), dan
    // draait enkel de finally hieronder.
    let outcome: "completed" | "failed" | "interrupted" = "interrupted";
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
        await remember(`Gesprekspartner: ${text}\n${being.name}: ${full}`, being.id);
      }
    }
  }

  // Alles wat deze instantie over het wezen weet; na verwijdering mag niets doorsijpelen naar een nieuw wezen.
  function forgetBeing(): void {
    current = undefined;
    workingMemory.length = 0;
    sessionMemoryIds.length = 0;
  }

  async function kill(id: number, confirmedName: string): Promise<Epitaph | null> {
    // Naam vergelijken met de rij in de database, niet met de sessie van deze instantie.
    const [being] = await deps.db.select().from(dynimos).where(eq(dynimos.id, id));
    if (!being || confirmedName !== being.name) return null;

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
      // De FK (ON DELETE CASCADE) ruimt de memories van deze dynimo hierbij meteen zelf op.
      const deleted = await tx.delete(dynimos).where(eq(dynimos.id, id)).returning({ id: dynimos.id });
      if (deleted.length === 0) return null;
      const [row] = await tx
        .insert(epitaphs)
        .values({ name: being.name, bornAt: being.bornAt, deletedAt: now(), farewellReflection })
        .returning();
      return row!;
    });

    if (current?.id === id) forgetBeing();
    return epitaph;
  }

  return { bringToLife, wake, sleep, kill, list, hear };
}
