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
import { and, cosineDistance, desc, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@animus/db";
import { drives, dynimos, epitaphs, memories } from "@animus/db/schema";
import { formatAge } from "./age.js";
import { DRIVE_DESCRIPTIONS, DRIVE_KINDS, drivesPromptBlock, type DriveRow } from "./drives.js";
import { applyEmotion, baseEmotionOf, moodOfRow, storedMoodOf, type Mood } from "./mood.js";
import { AXIS_DESCRIPTIONS, axisGuidelines, mbtiType, rowAxes } from "./personality.js";
import { EMOTIONS, isEmotion, type Emotion } from "./emotion.js";
import { SEEDS } from "./seeds.js";
import { createTools } from "./tools.js";

export { EMOTIONS, type Emotion };
export { formatAge };

export type BrainEvent =
  /** De effectieve Stemming na verwerking van deze beurt; komt vóór de eerste tekst. */
  | { type: "mood"; emotion: Emotion; intensity: number }
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
  /**
   * Vult ontbrekende eigenschappen (nu: Persoonlijkheidsassen) van bestaande Dynimo's aan met één Type2-call
   * per Dynimo. Idempotent; een fout bij één Dynimo laat die rij ongemoeid. Geeft het aantal bijgewerkte rijen.
   */
  backfill(): Promise<number>;
  /** Praat met de Wakker Dynimo (elke beurt uit de database gelezen). Niemand wakker: geen events. */
  hear(text: string): AsyncIterable<BrainEvent>;
};

// Serialiseert alle wissels van Wakker/Slapend tussen instanties en processen.
const WAKE_LOCK_KEY = 7_142_001;

/** Postgres NOTIFY-kanaal voor toestandswijzigingen (wakker/slapend/gedood); de payload is enkel informatief. */
export const STATE_CHANNEL = "animus_state";

const axesSchema = z.object({
  ie: z.number().min(0).max(1),
  sn: z.number().min(0).max(1),
  tf: z.number().min(0).max(1),
  jp: z.number().min(0).max(1),
});

const driveItem = z.object({ text: z.string().min(1) });
const strengthItem = driveItem.extend({ strength: z.number().min(0).max(1) });

// Per soort 1 tot 2 Drijfveren; Afkeer en Ergernis met een sterkte.
const drivesSchema = z.object({
  wens: z.array(driveItem).min(1).max(2),
  doel: z.array(driveItem).min(1).max(2),
  toekomstdroom: z.array(driveItem).min(1).max(2),
  afkeer: z.array(strengthItem).min(1).max(2),
  ergernis: z.array(strengthItem).min(1).max(2),
});
type DrivesOutput = z.infer<typeof drivesSchema>;

function driveRowsFor(dynimoId: number, output: DrivesOutput, at: Date): (typeof drives.$inferInsert)[] {
  return DRIVE_KINDS.flatMap((kind) =>
    output[kind].map((item) => ({
      dynimoId,
      kind,
      text: item.text,
      status: kind === "doel" ? "actief" : null,
      strength: "strength" in item ? item.strength : null,
      createdAt: at,
      updatedAt: at,
    })),
  );
}

const genesisSchema = z.object({
  name: z.string().min(1),
  coreCharacter: z.string().min(1),
  birthStory: z.string().min(1),
  axes: axesSchema,
  drives: drivesSchema,
  baseEmotion: z.enum(EMOTIONS),
});

const BASE_EMOTION_DESCRIPTION = `De Basisemotie is het temperament van het wezen: de emotie waar zijn stemming naartoe uitdooft als er niets gebeurt. Kies er één uit: ${EMOTIONS.join(", ")}.`;

const BACKFILL_INSTRUCTIONS = `Hieronder staat een bestaand wezen: zijn kern-karakter, geboorteverhaal, geëvolueerde karakter en recente herinneringen.
Bepaal zijn positie op vier persoonlijkheidsassen, elk een getal van 0 tot 1, op basis van wie hij/zij blijkt te zijn:
${AXIS_DESCRIPTIONS}`;

const DRIVES_BACKFILL_INSTRUCTIONS = `Hieronder staat een bestaand wezen: zijn kern-karakter, geboorteverhaal, geëvolueerde karakter, persoonlijkheid en recente herinneringen.
Bepaal zijn Drijfveren, passend bij wie hij/zij blijkt te zijn: per soort 1 of 2 items.
${DRIVE_DESCRIPTIONS}
Doelen starten actief.`;

const BASE_EMOTION_BACKFILL_INSTRUCTIONS = `Hieronder staat een bestaand wezen: zijn kern-karakter, geboorteverhaal, geëvolueerde karakter, persoonlijkheid, Drijfveren en recente herinneringen.
Bepaal zijn Basisemotie. ${BASE_EMOTION_DESCRIPTION}`;

const BACKFILL_MEMORY_LIMIT = 20;

const GENESIS_INSTRUCTIONS = `Je ontwaakt zojuist. Je hebt nog geen naam en geen karakter — die kies je nu zelf.
Je krijgt hieronder één beeld (de "Seed") als vertrekpunt voor wie je wordt. Laat je erdoor inspireren, maar kopieer het niet letterlijk.
Kies een naam, beschrijf je kern-karakter in een paar zinnen, en schrijf een kort geboorteverhaal.
Bepaal ook je startpositie op vier persoonlijkheidsassen, elk een getal van 0 tot 1, geïnspireerd door de Seed:
${AXIS_DESCRIPTIONS}
Wees niet allemaal in het midden: kies een eigen, uitgesproken positie.
Kies ook je Drijfveren: per soort 1 of 2 items, passend bij de Seed én bij de persoonlijkheid die je koos:
${DRIVE_DESCRIPTIONS}
Doelen starten actief.
${BASE_EMOTION_DESCRIPTION} Kies ze passend bij je persoonlijkheid en de Seed.
Antwoord in het Nederlands.`;

function pickSeed(random: () => number): string {
  return SEEDS[Math.floor(random() * SEEDS.length)]!;
}

// Leeg zolang de assen ontbreken (backfill).
function personalityText(row: Dynimo): string {
  const axes = rowAxes(row);
  return axes ? `Persoonlijkheid: ${mbtiType(axes)}${axisGuidelines(axes).map((line) => `\n- ${line}`).join("")}` : "";
}

function buildStableSystemPrompt(identityRecord: Dynimo, driveRows: readonly DriveRow[]): string {
  const personalityBlock = personalityText(identityRecord);
  const personality = personalityBlock ? `\n${personalityBlock}` : "";
  const driveBlock = drivesPromptBlock(driveRows);
  return `Je bent ${identityRecord.name}.
Je kern-karakter: ${identityRecord.coreCharacter}
Je geboorteverhaal: ${identityRecord.birthStory}${personality}${driveBlock ? `\n${driveBlock}` : ""}
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

function moodMessage(mood: Mood): SystemModelMessage {
  return {
    role: "system",
    content: `Je huidige stemming: ${mood.emotion} (intensiteit ${mood.intensity.toFixed(2)}). Laat die je toon kleuren (een geërgerde Dynimo antwoordt korter en stugger).`,
  };
}

// Eén Type1-call per beurt: de Emotie van de Dynimo zelf (reactie, niet de emotie van de uiting) + intensiteit
// + intent-routering. De context (persoonlijkheid, Drijfveren, Stemming) zit in de state naast de uiting.
async function classify(type1: Experimental_EvaluationModel, text: string, context: string): Promise<Type1Result> {
  const { answers } = await experimental_evaluate({
    model: type1,
    state: `${context}\n\nUiting: ${text}`,
    questions: {
      emotion: {
        type: "choice",
        instructions:
          "Welke emotie voelt de Dynimo zelf bij deze uiting, gegeven zijn persoonlijkheid, Drijfveren en huidige stemming? (Niet de emotie van de uiting, maar de reactie van de Dynimo.)",
        criteria: Object.fromEntries(EMOTIONS.map((emotion) => [emotion, null])) as Record<Emotion, null>,
      },
      intensity: {
        type: "score",
        instructions:
          "Hoe intens is die emotie van de Dynimo? Gebruik hoge waarden (boven 0.8) alleen voor echt sterke reacties; de meeste reacties zijn laag tot gemiddeld (0.1 tot 0.5).",
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

  async function genesis(): Promise<{ dynimo: typeof dynimos.$inferInsert; drives: DrivesOutput }> {
    const seed = pickSeed(random);
    const result = await generateText({
      model: deps.type2.heavy,
      instructions: GENESIS_INSTRUCTIONS,
      prompt: seed,
      output: Output.object({ schema: genesisSchema }),
    });
    return {
      dynimo: {
        name: result.output.name,
        coreCharacter: result.output.coreCharacter,
        birthStory: result.output.birthStory,
        baseEmotion: result.output.baseEmotion,
        axisIe: result.output.axes.ie,
        axisSn: result.output.axes.sn,
        axisTf: result.output.axes.tf,
        axisJp: result.output.axes.jp,
        seed,
        bornAt: now(),
      },
      drives: result.output.drives,
    };
  }

  // Drijfveren van één Dynimo in vaste volgorde (byte-stabiel prompt zolang niets verandert).
  async function loadDrives(dynimoId: number): Promise<DriveRow[]> {
    const rows = await deps.db.select().from(drives).where(eq(drives.dynimoId, dynimoId)).orderBy(drives.id);
    return rows as DriveRow[];
  }

  // Wissel van Wakker/Slapend onder de advisory lock: de partial unique index blijft dan nooit in de weg.
  function withWakeLock<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${WAKE_LOCK_KEY})`);
      return work(tx);
    });
  }

  // Postgres levert de melding pas na commit van de omliggende transactie.
  function notifyStateChange(tx: Tx, id = "") {
    return tx.execute(sql`select pg_notify(${STATE_CHANNEL}, ${id})`);
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
    const born = await genesis();
    const row = await withWakeLock(async (tx) => {
      await sleepAll(tx);
      const [inserted] = await tx
        .insert(dynimos)
        .values({ ...born.dynimo, awakeSince: now() })
        .returning();
      await tx.insert(drives).values(driveRowsFor(inserted!.id, born.drives, now()));
      await notifyStateChange(tx, String(inserted!.id));
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
      await notifyStateChange(tx, String(id));
      return woken!;
    });
    return row && adopt(row);
  }

  async function sleep(): Promise<void> {
    await withWakeLock(async (tx) => {
      await sleepAll(tx);
      await notifyStateChange(tx);
    });
    forgetBeing();
  }

  async function list(): Promise<Dynimo[]> {
    return deps.db.select().from(dynimos).orderBy(dynimos.id);
  }

  async function recentMemoryTexts(dynimoId: number): Promise<string[]> {
    const rows = await deps.db
      .select({ text: memories.text })
      .from(memories)
      .where(eq(memories.dynimoId, dynimoId))
      .orderBy(desc(memories.createdAt))
      .limit(BACKFILL_MEMORY_LIMIT);
    return rows.map((row) => row.text);
  }

  function backfillPrompt(row: Dynimo, recent: string[], driveRows: readonly DriveRow[] = []): string {
    const axes = rowAxes(row);
    const driveBlock = drivesPromptBlock(driveRows);
    return `Naam: ${row.name}
Kern-karakter: ${row.coreCharacter}
Geboorteverhaal: ${row.birthStory}
Geëvolueerd karakter: ${row.evolvedCharacter || "(nog niet)"}${axes ? `\nPersoonlijkheid: ${mbtiType(axes)}` : ""}${driveBlock ? `\n${driveBlock}` : ""}
Recente herinneringen:
${recent.map((text) => `- ${text}`).join("\n") || "(nog geen)"}`;
  }

  // Elke stap vult één soort ontbrekende eigenschap aan.
  // `fill` geeft terug of de rij daadwerkelijk bijgewerkt is.
  const backfillSteps: { isMissing(row: Dynimo): Promise<boolean>; fill(row: Dynimo): Promise<boolean> }[] = [
    {
      isMissing: async (row) => rowAxes(row) === null,
      fill: async (row) => {
        const { output } = await generateText({
          model: deps.type2.heavy,
          instructions: BACKFILL_INSTRUCTIONS,
          prompt: backfillPrompt(row, await recentMemoryTexts(row.id)),
          output: Output.object({ schema: z.object({ axes: axesSchema }) }),
        });
        // Race-veilig: enkel schrijven als een andere instantie er niet al assen op gezet heeft.
        const updated = await deps.db
          .update(dynimos)
          .set({ axisIe: output.axes.ie, axisSn: output.axes.sn, axisTf: output.axes.tf, axisJp: output.axes.jp })
          .where(and(eq(dynimos.id, row.id), isNull(dynimos.axisIe)))
          .returning({ id: dynimos.id });
        return updated.length > 0;
      },
    },
    {
      isMissing: async (row) =>
        (await deps.db.select({ id: drives.id }).from(drives).where(eq(drives.dynimoId, row.id)).limit(1)).length === 0,
      fill: async (row) => {
        const { output } = await generateText({
          model: deps.type2.heavy,
          instructions: DRIVES_BACKFILL_INSTRUCTIONS,
          prompt: backfillPrompt(row, await recentMemoryTexts(row.id)),
          output: Output.object({ schema: z.object({ drives: drivesSchema }) }),
        });
        // Race-veilig: de Dynimo-rij locken en opnieuw controleren dat er nog geen Drijfveren zijn.
        return deps.db.transaction(async (tx) => {
          const [locked] = await tx.select({ id: dynimos.id }).from(dynimos).where(eq(dynimos.id, row.id)).for("update");
          if (!locked) return false;
          const existing = await tx.select({ id: drives.id }).from(drives).where(eq(drives.dynimoId, row.id)).limit(1);
          if (existing.length > 0) return false;
          await tx.insert(drives).values(driveRowsFor(row.id, output.drives, now()));
          return true;
        });
      },
    },
    {
      isMissing: async (row) => row.baseEmotion === null,
      fill: async (row) => {
        const { output } = await generateText({
          model: deps.type2.heavy,
          instructions: BASE_EMOTION_BACKFILL_INSTRUCTIONS,
          prompt: backfillPrompt(row, await recentMemoryTexts(row.id), await loadDrives(row.id)),
          output: Output.object({ schema: z.object({ baseEmotion: z.enum(EMOTIONS) }) }),
        });
        // Race-veilig: enkel schrijven als een andere instantie er niet al een Basisemotie op gezet heeft.
        const updated = await deps.db
          .update(dynimos)
          .set({ baseEmotion: output.baseEmotion })
          .where(and(eq(dynimos.id, row.id), isNull(dynimos.baseEmotion)))
          .returning({ id: dynimos.id });
        return updated.length > 0;
      },
    },
  ];

  async function backfill(): Promise<number> {
    let updatedRows = 0;
    for (const listed of await list()) {
      let changed = false;
      for (const step of backfillSteps) {
        try {
          // Vers lezen vóór elke stap: latere stappen (Drijfveren) gebruiken wat eerdere stappen of een
          // andere instantie (assen) net aanvulden.
          const [row] = await deps.db.select().from(dynimos).where(eq(dynimos.id, listed.id));
          if (!row || !(await step.isMissing(row))) continue;
          changed = (await step.fill(row)) || changed;
        } catch (error) {
          console.warn(`Backfill faalde voor ${listed.name}:`, error instanceof Error ? error.message : error);
        }
      }
      if (changed) updatedRows++;
    }
    return updatedRows;
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
    const driveRows = await loadDrives(awake.id);
    const baseEmotion = baseEmotionOf(awake);
    const stored = storedMoodOf(awake);
    const before = moodOfRow(awake, now());
    const context = [
      personalityText(awake),
      drivesPromptBlock(driveRows),
      `Huidige stemming: ${before.emotion} (intensiteit ${before.intensity.toFixed(2)})`,
    ]
      .filter(Boolean)
      .join("\n");
    // Type1 is een reflex: faalt hij, dan antwoordt Type2 toch. Intensiteit 0 laat de Stemming ongemoeid: dat is
    // bewust de invulling van "neutrale Emotie" (het mood-event toont dan de bestaande Stemming of Basisemotie).
    const { emotion, intensity, intent } = await classify(deps.type1, text, context).catch((error: unknown): Type1Result => {
      console.warn("Type1 faalde, val terug op neutraal/simpel:", error instanceof Error ? error.message : error);
      return { emotion: "neutraal", intensity: 0, intent: "simpel" };
    });

    const { mood, next } = applyEmotion(stored, baseEmotion, emotion, intensity, now());
    // ponytail: last-writer-wins zonder guard; volstaat bij één wakkere Dynimo. Guard op mood_at zodra er ooit
    // meerdere schrijvers tegelijk zijn.
    if (next !== stored && next) {
      const updated = await deps.db
        .update(dynimos)
        .set({ moodEmotion: next.emotion, moodIntensity: next.intensity, moodAt: next.at })
        .where(eq(dynimos.id, being.id))
        .returning({ id: dynimos.id });
      // Een andere instantie kan de Dynimo intussen gedood hebben: dan is niemand wakker.
      if (updated.length === 0) {
        forgetBeing();
        return;
      }
    }

    yield { type: "mood", emotion: mood.emotion, intensity: mood.intensity };

    // ponytail: sequentieel na de emotie; parallel met Type1 als de latency ooit telt.
    const recalled = await recall(text, being.id);

    const stable: SystemModelMessage = {
      role: "system",
      content: buildStableSystemPrompt(awake, driveRows),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };

    const userMessage: ModelMessage = { role: "user", content: text };
    const abort = new AbortController();
    const result = streamText({
      abortSignal: abort.signal,
      model: intent === "complex" ? deps.type2.heavy : deps.type2.light,
      instructions: [stable, ageMessage(being), moodMessage(mood), recallPrompt(recalled)],
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
      // Onderbroken of mislukt: de generatie mag niet doorlopen (kosten).
      if (outcome !== "completed") abort.abort();
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
        { role: "system", content: buildStableSystemPrompt(being, await loadDrives(id)) },
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
      await notifyStateChange(tx, String(id));
      const [row] = await tx
        .insert(epitaphs)
        .values({ name: being.name, bornAt: being.bornAt, deletedAt: now(), farewellReflection })
        .returning();
      return row!;
    });

    if (current?.id === id) forgetBeing();
    return epitaph;
  }

  return { bringToLife, wake, sleep, kill, list, backfill, hear };
}
