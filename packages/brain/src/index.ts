import {
  embed,
  experimental_evaluate,
  generateText,
  isStepCount,
  streamText,
  tool,
  Output,
  type EmbeddingModel,
  type Experimental_EvaluationModel,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
} from "ai";
import { and, asc, cosineDistance, desc, eq, gt, gte, inArray, isNotNull, isNull, l2Distance, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@animus/db";
import { dreams, drives, dynimos, epitaphs, faceEmbeddings, familiarities, memories, persons, settings, voiceProfiles as voiceProfilesTable } from "@animus/db/schema";
import type { Type2Catalog } from "./config.js";
import type { JobEnqueue } from "./jobs.js";
import { formatAge } from "./age.js";
import { archetypeOfferText, getArchetype, pickOffer } from "./archetypes.js";
import { drivesPromptBlock, isActiveDrive, type DriveRow } from "./drives.js";
import { decideBehavior } from "./behavior.js";
import { decideOpinion, matchDrives, opinionPrompt, OPINION_BOOS_DELTA } from "./opinion.js";
import { pickSpeechSound } from "./speech-sounds.js";
import { createPacer, pacingFor } from "./speech-pacing.js";
import { pickDreamToTell, DREAM_MAX_AGE_MS } from "./dream-tell.js";
import { pickSpontaneousMemory, spontaneousChance, SPONTANEOUS_INITIATIVE_CHANCE, SPONTANEOUS_MIN_AGE_MS, SPONTANEOUS_MIN_IMPRESSION, SPONTANEOUS_TURN_CHANCE, type SpontaneousCandidate } from "./recall-spontaneous.js";
import { applyDeltas, baseEmotionOf, currentMood, moodOfRow, singleEmotionValues, storedMoodOf, type MoodDeltas, type MoodValues, type StoredMood } from "./mood.js";
import { isVisibleMoodChange, soundKindFor, type SoundKind } from "./sound.js";
import { FAMILIARITY_DEFAULT, FAMILIARITY_POSITIVE_DELTA, updateFamiliarity } from "./familiarity.js";
import { type Axes, mbtiType, rowAxes } from "./personality.js";
import { growVerstand, rollVerstand } from "./verstand.js";
import { EMOTIONS, type Emotion } from "./emotion.js";
import { createTools } from "./tools.js";
import { chooseGenesisVoice, type GenesisVoiceDeps } from "./genesis-voice.js";
import { DEFAULT_FACE_MATCH_DISTANCE, type Aanleiding, type Gesprekspartner } from "./perception.js";
import { classify, DELTA_TABLE, type Type1Result } from "./type1.js";
import { axesSchema, driveRowsFor, drivesSchema, genesisSchema, type DrivesOutput } from "./genesis-schema.js";
import { violatedForeignKey, type Tx } from "./db-util.js";
import {
  type Dynimo,
  BACKFILL_INSTRUCTIONS,
  DRIVES_BACKFILL_INSTRUCTIONS,
  REFLECTION_MEMORY_LIMIT,
  AXIS_SHIFT_LIMIT,
  MAX_ACTIVE_PER_KIND,
  DREAM_RECALL_CHANCE,
  DREAM_CHANCE,
  reflectionSchema,
  REFLECTION_INSTRUCTIONS,
  BASE_EMOTION_BACKFILL_INSTRUCTIONS,
  BACKFILL_MEMORY_LIMIT,
  GENESIS_INSTRUCTIONS,
  genesisArchetypeInstructions,
  pickSeed,
  personalityText,
  buildStableSystemPrompt,
  FAREWELL_PROMPT,
  MAX_WORKING_MEMORY_TURNS,
  WORKING_MEMORY_TRIM_TO,
  trimWorkingMemory,
  RECALL_LIMIT,
  RECALL_PRESENT_BONUS,
  RECALL_CANDIDATES,
  MAX_FACE_EMBEDDINGS,
  MAX_VOICE_PROFILES,
  FACE_SURE_MATCH_FACTOR,
  FACE_EMBEDDING_MIN_AGE_MS,
  MAX_UNKNOWN_FACE_EMBEDDINGS,
  UNKNOWN_FACE_MAX_AGE_MS,
  dayOf,
  isBirthday,
  BIRTHDAY_DELTA,
  recallPrompt,
  DISCRETION_MESSAGE,
  SPONTANEOUS_CANDIDATE_LIMIT,
  DREAM_HOW,
  SPONTANEOUS_HOW,
  spontaneousPrompt,
  dreamPrompt,
  BEHAVIOR_PROMPTS,
  moodMessage,
  familiarityMessage,
  speakerMessage,
  aanwezigMessage,
  UNKNOWN_NAME_PROMPT,
  NAAM_SCHEMA,
  NIETS_ZIEN,
  stripBeelden,
} from "./prompts.js";
export { defaultVoiceDeps } from "./genesis-voice.js";
export { genesisSchema };
export { DELTA_TABLE, MAX_WORKING_MEMORY_TURNS, WORKING_MEMORY_TRIM_TO };
export type { Dynimo };

export { EMOTIONS, type Emotion };
export { formatAge };

export type BrainEvent =
  /** De effectieve Stemming na verwerking van deze beurt; komt vóór de eerste tekst. */
  | { type: "mood"; emotion: Emotion; intensity: number; values: Record<Emotion, number> }
  /** De Stemming is zichtbaar veranderd: een kort geluidje van deze soort; komt direct na het mood-event. */
  | { type: "sound"; kind: SoundKind }
  /** Er ging deze beurt echt een camerabeeld naar Type2 (Type1-/initiatief-pad of de kijk-tool). */
  | { type: "kijk" }
  /** Er is net iemand leren kennen (leerKennen); de agent kan hierop het stemprofiel beginnen opbouwen. */
  | { type: "persoon"; personId: number; naam: string }
  | { type: "text"; delta: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolName: string; output: unknown };

/** Eén camerabeeld: JPEG-data (max 768px lange zijde), zoals door lookFrame() geleverd. */
export type Frame = { data: Uint8Array; mediaType: "image/jpeg" };

export type Epitaph = typeof epitaphs.$inferSelect;

/** Dashboard (#95): één rij van `listPersons()`. */
export type PersonSummary = { id: number; name: string; owner: boolean; createdAt: Date; faceCount: number; voiceCount: number; memoryCount: number };

export type Type2Models = { light: LanguageModel; heavy: LanguageModel };

export type Brain = {
  /**
   * Modelwissel-experiment (#123): provider:model-ids waaruit `setType2Models` mag kiezen. Zonder `type2Catalog`-
   * dep (geen catalogus meegegeven) altijd leeg — dan is modelwissel niet beschikbaar.
   */
  availableModels(): string[];
  /**
   * Actief Type2-model (licht + zwaar), zoals de eerstvolgende beurt hem gebruikt. `isDefault` is true als geen
   * van beide velden expliciet ingesteld is (dan gelden de env-standaarden). Zonder `type2Catalog`-dep: de vaste
   * modelId's van `deps.type2`, altijd `isDefault: true` (zie createBrain hieronder voor de precieze afweging).
   */
  type2Models(): Promise<{ light: string; heavy: string; isDefault: boolean }>;
  /**
   * Modelwissel-experiment (#123): zet het globale Type2-model (licht/zwaar apart); null = terug naar de
   * env-standaard voor dat veld. Gooit bij een id buiten `availableModels()`, of zonder `type2Catalog`-dep.
   * Geldt meteen voor de eerstvolgende beurt, geen herstart nodig (geen caching, geen NOTIFY: elke Type2-aanroep
   * leest de instelling zelf opnieuw).
   */
  setType2Models(choice: { light: string | null; heavy: string | null }): Promise<void>;
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
   * Meldt "kenmerken:<id>" op het toestandskanaal per bijgewerkte rij (#111).
   */
  backfill(): Promise<number>;
  /**
   * Reflectie van de wakkere Dynimo (bij stilte); hij blijft wakker. `onStart` draait vlak vóór de Type2-call en
   * niet als er niets te reflecteren valt. Geeft true bij een toegepaste Reflectie, anders false; gooit nooit.
   * `aanwezig` (#94): Persoon-ids die tijdens de stilte in beeld waren; hun Vertrouwdheid daalt dan niet mee. Zonder
   * (weggelaten): huidig gedrag, iedereen daalt.
   */
  reflect(hooks?: { onStart?: () => void; aanwezig?: number[] }): Promise<boolean>;
  /**
   * Voert de Reflectie van één Dynimo echt uit (#125: door de worker aangeroepen, buiten deze brain-instantie om
   * ingepland). Meldt "reflectie:start:<id>" op het toestandskanaal vlak vóór de Type2-call, en (enkel als die
   * start-melding gebeurde) in een finally "reflectie:einde:<id>" — ook als de call faalt. Gooit door bij een fout
   * (i.t.t. `reflect()`/`reflectAll()`, die nooit gooien): BullMQ moet de job dan als mislukt zien en herkansen.
   */
  runReflection(dynimoId: number, options: { sleeping: boolean; aanwezig?: number[] }): Promise<void>;
  /**
   * Meldt van buitenaf (#125: de agent op basis van een NOTIFY van de worker) dat een Reflectie van deze Dynimo
   * start (`running: true`) of eindigt (`running: false`). Werkt dezelfde teller bij als reflectDynimo() intern
   * gebruikt, zodat considerInitiative() ook een Reflectie die in een ander proces (de worker) draait respecteert.
   */
  noteReflection(dynimoId: number, running: boolean): void;
  /**
   * Dashboard-override: zet de Stemming van deze Dynimo direct (ook lager dan de huidige); ze dooft daarna
   * gewoon uit, de Basisemotie blijft ongewijzigd. False bij een onbekende id; gooit bij een ongeldige intensiteit.
   */
  forceMood(id: number, emotion: Emotion, intensity: number): Promise<boolean>;
  /** Dashboard-override: zet de volledige Stemmingsvector (0–100 per emotie) met tijdstip nu; geen pinning, ze dooft gewoon uit. False bij een onbekende id. */
  setMood(id: number, values: MoodValues): Promise<boolean>;
  /** Dashboard-override: zet de vier Persoonlijkheidsassen (0–1) direct; gesprekken en Reflecties schuiven ze daarna weer op. False bij een onbekende id. */
  setAxes(id: number, axes: Axes): Promise<boolean>;
  /** Dashboard: zet de TTS-stem (null = default van de agent); de agent past die direct toe. False bij een onbekende id. */
  setVoiceProfile(id: number, profile: { voice: string | null; description: string | null }): Promise<boolean>;
  /** Dashboard-override: zet de Vertrouwdheid van de eigenaar (0–1). False bij een onbekende id. */
  setFamiliarity(id: number, familiarity: number): Promise<boolean>;
  /** Dashboard: Vertrouwdheid van `personId` (default eigenaar) met deze Dynimo; 0.2 zonder rij (#91). Leest de eigenaar enkel, maakt hem nooit aan (#111). */
  familiarityOf(dynimoId: number, personId?: number): Promise<number>;
  /** Naam van `personId` (default eigenaar), of null zonder rij; één lichte query, maakt de eigenaar nooit aan (#111). */
  personName(personId?: number): Promise<string | null>;
  /** Alle Stemprofielen (Eagle-export) van elke Persoon; nooit audio zelf (#92). */
  voiceProfiles(): Promise<{ personId: number; profile: Uint8Array }[]>;
  /** Voegt een Stemprofiel toe voor `personId`; houdt er hoogstens 5 (oudste eerst weg), in één transactie (#92). */
  addVoiceProfile(personId: number, profile: Uint8Array): Promise<void>;
  /**
   * Matcht gezichts-embeddings (Human, 1024-dimensionaal) tegen bekende Personen; `null` per embedding zonder
   * zekere match. Onthoudt onbekende embeddings kort in de sessie zodat `leerKennen` ze kan koppelen (#93).
   */
  recognizeFaces(embeddings: number[][]): Promise<(number | null)[]>;
  /** Dashboard-override: zet het Verstand (0–1), zonder pinning. False bij een onbekende id. */
  setVerstand(id: number, verstand: number): Promise<boolean>;
  /** Dashboard-override: kiest een archetype en zet zijn zes assen, Basisemotie en Verstand (richtwaarde) als startpunt (geen pinning). False bij een onbekende id of een onbekend archetype. */
  setArchetype(id: number, archetypeId: string): Promise<boolean>;
  /**
   * Dashboard-override: voegt een Herinnering toe met dezelfde embed-stap als een normale beurt en de neutrale
   * Indruk 0.5. False bij een onbekende id; gooit als het embedden of opslaan faalt.
   */
  addMemory(id: number, text: string): Promise<boolean>;
  /** Dashboard-override: verwijdert een Herinnering hard, enkel als die van deze Dynimo is. False als er niets verwijderd is. */
  removeMemory(id: number, memoryId: number): Promise<boolean>;
  /** Dashboard (#95): alle Personen met hun aantal gezichts-/stemprofielen en Herinneringen; eigenaar eerst, dan op aanmaakdatum. */
  listPersons(): Promise<PersonSummary[]>;
  /** Dashboard (#95): hernoemt een Persoon (zelfde naamvalidatie als leerKennen). False bij een ongeldige naam of een onbekende id; de eigenaar mag ook hernoemd worden. */
  renamePerson(id: number, name: string): Promise<boolean>;
  /**
   * Dashboard (#95): voegt removeId samen in keepId. Herinneringen en embeddings (gezicht + stem) verhuizen, per
   * soort blijven daarna hoogstens 5 over (de nieuwste). Per Dynimo blijft de hoogste Vertrouwdheid van beide
   * Personen over op keepId. Is removeId de eigenaar, dan gaat de owner-vlag naar keepId. False bij gelijke of
   * onbekende ids. Meldt "persons:" op het toestandskanaal (#95): de agent herlaadt zijn stemprofielen en gezichten.
   */
  mergePersons(keepId: number, removeId: number): Promise<boolean>;
  /**
   * Dashboard (#95): verwijdert een Persoon, enkel als `confirmedName` exact zijn naam is (zoals `kill`).
   * Embeddings/stemprofielen cascaden weg, Herinneringen blijven zonder Persoon. False bij de eigenaar, een foute
   * naam of een onbekende id. Meldt "persons:" op het toestandskanaal bij succes.
   */
  deletePerson(id: number, confirmedName: string): Promise<boolean>;
  /**
   * Dashboard (#95): wist gezichts-embeddings en Stemprofielen van een Persoon; de Persoon blijft. False bij een
   * onbekende id. Meldt "persons:" op het toestandskanaal bij succes.
   */
  relearnPerson(id: number): Promise<boolean>;
  /**
   * Initiatief-check (Type1): wil de wakkere Dynimo nu uit zichzelf iets zeggen? Geeft een instructie voor het
   * spontane openingswoord (te voeden aan `hear(..., { initiatief: true })`), of null. Niemand wakker of een
   * lopende Reflectie: altijd null. Gooit nooit; wijzigt nooit de status van een Doel.
   * Met `aanleiding` (een Waarneming, ADR-0018) krijgt Type1 die als extra context; bij "ja" gaat de aanleiding
   * vóór Spontane herinnering en Droom (die worden dan niet gekozen) en verwerkt de instructie de aanleiding.
   * Bij aanleiding "nieuw-object" en "ja" wordt de eerstvolgende `hear(..., { initiatief: true })` een Kijk-beurt
   * (het beeld gaat mee, ADR-0019).
   * `aanwezig` (#94): Persoon-ids voor de Spontane herinnering (considerInitiative kent geen Gesprekspartner); default
   * de eigenaar.
   */
  considerInitiative(aanleiding?: Aanleiding, options?: { aanwezig?: number[] }): Promise<string | null>;
  /**
   * Praat met de Wakker Dynimo (elke beurt uit de database gelezen). Niemand wakker: geen events.
   * Met `initiatief` is `text` de instructie uit `considerInitiative()` i.p.v. een uiting van de Gesprekspartner:
   * geen Type1-classificatie (Stemming blijft), en de herinnering bevat enkel wat de Dynimo zei.
   * `gesprekspartner` (#91/#115): "persoon" (een Persoon-id), "onbekend" (Vertrouwdheid 0.2, nooit opgeslagen, geen
   * Persoon op de Herinnering), of "geen-signaal" (weggelaten telt ook als "geen-signaal") = de eigenaar. Bij
   * `initiatief` krijgt de Herinnering ook de eigenaar tenzij hier een Gesprekspartner is meegegeven.
   * `aanwezig` (#93/#94): de Persoon-ids die nu in beeld zijn (gezichtsherkenning); Type2 krijgt na het cachepunt wie
   * er aanwezig is (eigenaar als "je eigenaar", onbekende ids overgeslagen). Weggelaten: geen regel (zoals nu). Samen
   * met de Gesprekspartner bepaalt dit de voorrang bij het ophalen van Herinneringen en de Spontane herinnering
   * (#94); zonder beide de eigenaar.
   */
  hear(text: string, options?: { initiatief?: boolean; gesprekspartner?: Gesprekspartner; aanwezig?: number[] }): AsyncIterable<BrainEvent>;
  /**
   * Wacht tot alle achtergrondschrijfacties van hear() (Herinnering opslaan, lastRecalledAt/toldAt bijwerken)
   * klaar zijn (#109). Nodig in tests die direct na hear() de database lezen, en vóór het afsluiten van het
   * proces (anders gaan nog lopende Herinneringen verloren). Gooit nooit; een fout is dan al gelogd.
   */
  settled(): Promise<void>;
};

// Serialiseert alle wissels van Wakker/Slapend tussen instanties en processen.
const WAKE_LOCK_KEY = 7_142_001;

/** Postgres NOTIFY-kanaal voor toestandswijzigingen. De payload stuurt de consument (dynimo-watch.ts `routeNotifyPayload`): STATE_PREFIXES verversen enkel dat deel; elke andere payload (wakker/slapend/gedood/genesis) laat de wakkere Dynimo opnieuw lezen. */
export const STATE_CHANNEL = "animus_state";

/** Payload-prefixen op STATE_CHANNEL (#111): producer (dit bestand) en consument (dynimo-watch.ts `routeNotifyPayload`) delen deze, i.p.v. losse string-literals. */
export const STATE_PREFIXES = {
  mood: "mood:",
  voice: "voice:",
  persons: "persons:",
  kenmerken: "kenmerken:",
  /** Reflectie-voortgang (#125): "reflectie:start:<id>" / "reflectie:einde:<id>", gemeld door de worker (runReflection). */
  reflectie: "reflectie:",
} as const;

export function createBrain(deps: {
  db: Db;
  type1: Experimental_EvaluationModel;
  type2: Type2Models;
  /**
   * Modelwissel-experiment (#123): curated catalogus + resolver voor het globaal instelbare Type2-model.
   * Ontbreekt deze: `availableModels()` geeft [], `setType2Models` gooit, `type2Models()` geeft de vaste
   * modelId's van `type2` terug (altijd `isDefault: true`) — kortom, gedraagt zich als vóór #123.
   */
  type2Catalog?: Type2Catalog;
  embedder: EmbeddingModel;
  now?: () => Date;
  random?: () => number;
  /** Stemkeuze bij genesis; default: geen (geen netwerk). Aanroepers geven defaultVoiceDeps(process.env) mee. */
  voices?: GenesisVoiceDeps;
  /** Levert het laatste camerabeeld, of null zonder beeld. Ontbreekt deze: blind, brain gedraagt zich als nu. */
  lookFrame?: () => Promise<Frame | null>;
  /** Drempel (L2-afstand, pgvector `<->`) voor een "zekere" gezichtsmatch (#93); default afgeleid, zie DEFAULT_FACE_MATCH_DISTANCE. */
  faceMatchDistance?: number;
  /**
   * Achtergrondtaken via de wachtrij (#125, ADR-0022). Aanwezig: reflectAll()/reflect() plannen een reflectie-job
   * in i.p.v. zelf te reflecteren en wachten er niet op. Ontbreekt deze: exact het huidige gedrag (rechtstreeks
   * reflecteren) — zo blijven tests en CLI's zonder Redis werken. De worker geeft dit nooit mee: die voert de job
   * juist zelf uit via runReflection().
   */
  jobs?: { enqueue: JobEnqueue };
}): Brain {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const voices = deps.voices;
  const faceMatchDistance = deps.faceMatchDistance ?? DEFAULT_FACE_MATCH_DISTANCE;
  let current: Dynimo | undefined;

  // Alle sessiestaat van één Wakker-generatie (#114), samen in één object i.p.v. losse instance-velden: bij een
  // wissel (adopt/resetSession) wordt dit object vervangen, nooit hergebruikt. Een beurt legt zijn sessie meteen
  // bij de start vast (`const s = session`) en schrijft daarna enkel nog naar die vastgelegde `s` — ook op de
  // achtergrond (#109) en ook als `session` intussen alweer naar een volgende generatie wijst. Een schrijfactie in
  // een inmiddels vervangen (niet meer huidige) `s` komt dan simpelweg in een wees-object terecht en bereikt de
  // nieuwe sessie nooit: dat ís de garantie, zonder aparte "is dit nog actueel"-check.
  type Session = {
    workingMemory: ModelMessage[];
    // Herinneringen uit deze sessie staan al in het werkgeheugen; niet dubbel ophalen.
    sessionMemoryIds: number[];
    // Herinneringen van de onbekende (person_id null) uit deze sessie (#92): leerKennen koppelt ze aan de nieuwe Persoon.
    unknownSessionMemoryIds: number[];
    // Al naar de naam gevraagd deze sessie (#92)? Voorkomt opnieuw vragen na een weigering.
    askedName: boolean;
    // Onbekende gezichts-embeddings van deze sessie (#93): leerKennen koppelt wat hier nog binnen de vervaltijd valt.
    unknownFaceEmbeddings: { embedding: number[]; at: number }[];
    // Spontane herinnering die considerInitiative koos: pas na de initiatief-beurt als aangehaald gemarkeerd.
    pendingSpontaneousId: number | undefined;
    // Idem voor een Droom die considerInitiative koos (verteld = told_at).
    pendingDreamId: number | undefined;
    // considerInitiative(nieuw-object) + "ja" zet dit; de eerstvolgende hear(..., { initiatief: true }) verbruikt
    // het als `kijken` (ADR-0019): zo gaat het beeld mee in precies die ene initiatiefbeurt.
    pendingLook: boolean;
    // considerInitiative(onbekend) + "ja" zet dit; pas de eerstvolgende hear(..., { initiatief: true }) verbruikt hem
    // door askedName te zetten (#114) — ketst dat initiatief af (geen hear-beurt), dan is askedName nooit verbruikt.
    pendingAskName: boolean;
    // vorige beurt genegeerd? Voorkomt twee keer achter elkaar negeren.
    lastIgnored: boolean;
    // beurten (zonder initiatief) van deze sessie, voor de cooldown van het Standpunt.
    turnCount: number;
    lastOpinionTurn: number | undefined;
    // Spraakgeluid van de vorige beurt: nooit twee keer hetzelfde.
    lastSpeechSound: string | undefined;
  };
  function newSession(): Session {
    return {
      workingMemory: [],
      sessionMemoryIds: [],
      unknownSessionMemoryIds: [],
      askedName: false,
      unknownFaceEmbeddings: [],
      pendingSpontaneousId: undefined,
      pendingDreamId: undefined,
      pendingLook: false,
      pendingAskName: false,
      lastIgnored: false,
      turnCount: 0,
      lastOpinionTurn: undefined,
      lastSpeechSound: undefined,
    };
  }
  let session = newSession();

  // Achtergrondschrijfacties van hear() (#109): Herinnering opslaan, lastRecalledAt/toldAt. settled() wacht ze af.
  const pendingWrites = new Set<Promise<unknown>>();
  function trackBackground(promise: Promise<unknown>): void {
    pendingWrites.add(promise);
    promise.finally(() => pendingWrites.delete(promise));
  }
  async function settled(): Promise<void> {
    await Promise.allSettled(pendingWrites);
  }

  // Modelwissel-experiment (#123): id van een Type2-model voor op de Herinnering. `deps.type2.light/.heavy` zijn
  // altijd al opgeloste LanguageModel-instanties (geen catalog); hun `modelId` is dan het enige zinvolle id.
  function modelIdOf(model: LanguageModel): string {
    return typeof model === "string" ? model : model.modelId;
  }

  function availableModels(): string[] {
    return deps.type2Catalog?.available ?? [];
  }

  // Enige plek die de settings-rij leest; elke Type2-aanroep (ook hear()) roept dit zelf aan, per aanroep één
  // kleine select, bewust geen caching/NOTIFY (ticket #123: minder complex, en modelwissel is een laagfrequente
  // dashboard-actie). Zonder `type2Catalog`-dep helemaal geen select: het gedrag van vóór #123 blijft exact gelijk.
  async function activeType2(): Promise<{ light: { id: string; model: LanguageModel }; heavy: { id: string; model: LanguageModel } }> {
    if (!deps.type2Catalog) {
      return { light: { id: modelIdOf(deps.type2.light), model: deps.type2.light }, heavy: { id: modelIdOf(deps.type2.heavy), model: deps.type2.heavy } };
    }
    const catalog = deps.type2Catalog;
    const [row] = await deps.db.select().from(settings).where(eq(settings.id, 1));
    const lightId = row?.type2Light ?? catalog.defaults.light;
    const heavyId = row?.type2Heavy ?? catalog.defaults.heavy;
    return { light: { id: lightId, model: catalog.resolve(lightId) }, heavy: { id: heavyId, model: catalog.resolve(heavyId) } };
  }

  async function type2Models(): Promise<{ light: string; heavy: string; isDefault: boolean }> {
    // Zonder catalog is er niets instelbaars: de vaste modelId's van deps.type2 zijn dan per definitie "de standaard".
    if (!deps.type2Catalog) return { light: modelIdOf(deps.type2.light), heavy: modelIdOf(deps.type2.heavy), isDefault: true };
    const catalog = deps.type2Catalog;
    const [row] = await deps.db.select().from(settings).where(eq(settings.id, 1));
    return {
      light: row?.type2Light ?? catalog.defaults.light,
      heavy: row?.type2Heavy ?? catalog.defaults.heavy,
      isDefault: (row?.type2Light ?? null) === null && (row?.type2Heavy ?? null) === null,
    };
  }

  async function setType2Models(choice: { light: string | null; heavy: string | null }): Promise<void> {
    if (!deps.type2Catalog) throw new Error("Modelwissel niet beschikbaar: brain is aangemaakt zonder type2Catalog.");
    const available = deps.type2Catalog.available;
    for (const [label, id] of [["light", choice.light] as const, ["heavy", choice.heavy] as const]) {
      if (id !== null && !available.includes(id)) {
        throw new Error(`Onbekend Type2-model voor ${label}: "${id}". Toegestaan: ${available.join(", ")}`);
      }
    }
    await deps.db
      .insert(settings)
      .values({ id: 1, type2Light: choice.light, type2Heavy: choice.heavy })
      .onConflictDoUpdate({ target: settings.id, set: { type2Light: choice.light, type2Heavy: choice.heavy } });
  }

  async function genesis(): Promise<{ dynimo: typeof dynimos.$inferInsert; drives: DrivesOutput; voice: { voice: string; description: string } | null }> {
    const seed = pickSeed(random);
    const offer = pickOffer(random);
    const result = await generateText({
      model: (await activeType2()).heavy.model,
      instructions: `${GENESIS_INSTRUCTIONS}\n${genesisArchetypeInstructions(archetypeOfferText(offer))}`,
      prompt: seed,
      output: Output.object({ schema: genesisSchema }),
    });
    // Enkel een aangeboden archetype telt; anders kiest de rng er een uit het aanbod.
    const archetype = offer.find((candidate) => candidate.id === result.output.archetype) ?? offer[Math.floor(random() * offer.length)]!;
    const { axes } = archetype;
    // Verstand-worp (ticket #98): ná alle bovenstaande random()-aanroepen, zodat hun volgorde ongewijzigd blijft.
    const verstand = rollVerstand(archetype.verstand, random);
    return {
      dynimo: {
        name: result.output.name,
        coreCharacter: result.output.coreCharacter,
        birthStory: result.output.birthStory,
        baseEmotion: archetype.baseEmotion,
        archetype: archetype.id,
        axisIe: axes.ie,
        axisSn: axes.sn,
        axisTf: axes.tf,
        axisJp: axes.jp,
        axisReactivity: axes.reactivity,
        axisExpressiveness: axes.expressiveness,
        verstand,
        seed,
        bornAt: now(),
      },
      drives: result.output.drives,
      voice: voices
        ? await chooseGenesisVoice(voices, {
            description: result.output.voiceDescription,
            searchTerms: result.output.voiceSearchTerms,
            hint: archetype.voiceHint,
            name: result.output.name,
          })
        : null,
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

  // Postgres levert de melding pas na commit van de omliggende transactie. Zonder omliggende transactie
  // (enkel `deps.db`) is de voorgaande schrijfactie zelf al auto-commit, dus de volgorde blijft kloppen.
  // Payload "kenmerken:<id>" (net als "mood:"/"voice:"): het gezichtje ververst dan enkel de kenmerken, zonder
  // wissel of Galerij-update (zie setAxes/setVerstand/setArchetype/setFamiliarity/renamePerson).
  function notifyStateChange(db: Db | Tx, id = "") {
    return db.execute(sql`select pg_notify(${STATE_CHANNEL}, ${id})`);
  }

  // Geeft de ids terug van wie wakker was: die krijgen na de wissel een Reflectie.
  async function sleepAll(tx: Tx): Promise<number[]> {
    const slept = await tx
      .update(dynimos)
      .set({ awakeSince: null })
      .where(isNotNull(dynimos.awakeSince))
      .returning({ id: dynimos.id });
    return slept.map((row) => row.id);
  }

  // Reflectie na de wissel (de wissel zelf is dan al gecommit en genotificeerd). Een fout mag het slapen niet breken.
  // Met `deps.jobs` (#125): enkel inplannen (dedup per Dynimo), de worker voert 'm uit — hier dus geen Type2-call.
  async function reflectAll(ids: number[]): Promise<void> {
    for (const id of ids) {
      try {
        if (deps.jobs) await deps.jobs.enqueue("reflectie", { dynimoId: id, sleeping: true }, { deduplication: { id: `reflectie:${id}` } });
        else await reflectDynimo(id);
      } catch (error) {
        const what = deps.jobs ? "inplannen" : "";
        console.warn(`Reflectie${what ? ` ${what}` : ""} faalde voor Dynimo ${id}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // Geeft true als er een Reflectie is toegepast. `onStart` draait synchroon vlak vóór de Type2-call, en dus niet
  // als er niets te reflecteren valt.
  // Lopende Reflecties per Dynimo-id (#114): enkel díe Dynimo neemt tijdens zijn eigen Reflectie geen initiatief,
  // niet de hele instantie (anders blokkeert de slaap-Reflectie van A het initiatief van B).
  const reflecting = new Map<number, number>();
  async function reflectDynimo(id: number, onStart?: () => void | Promise<void>, sleeping = true, aanwezig?: number[]): Promise<boolean> {
    reflecting.set(id, (reflecting.get(id) ?? 0) + 1);
    try {
      return await reflectDynimoInner(id, onStart, sleeping, aanwezig);
    } finally {
      const left = reflecting.get(id)! - 1;
      if (left > 0) reflecting.set(id, left);
      else reflecting.delete(id);
    }
  }

  async function reflectDynimoInner(id: number, onStart: (() => void | Promise<void>) | undefined, sleeping: boolean, aanwezig?: number[]): Promise<boolean> {
    const [row] = await deps.db.select().from(dynimos).where(eq(dynimos.id, id));
    if (!row) return false;
    const fresh = await deps.db
      .select()
      .from(memories)
      .where(row.lastReflectedAt ? and(eq(memories.dynimoId, id), gt(memories.createdAt, row.lastReflectedAt)) : eq(memories.dynimoId, id))
      .orderBy(asc(memories.createdAt), asc(memories.id))
      .limit(REFLECTION_MEMORY_LIMIT);
    if (fresh.length === 0) return false;
    if (fresh.length === REFLECTION_MEMORY_LIMIT) {
      // De batchgrens mag niet midden in een timestamp vallen: `last_reflected_at` + strikt `>` zou de rest verliezen.
      const last = fresh[fresh.length - 1]!;
      fresh.push(
        ...(await deps.db
          .select()
          .from(memories)
          .where(and(eq(memories.dynimoId, id), eq(memories.createdAt, last.createdAt), gt(memories.id, last.id)))
          .orderBy(asc(memories.id))),
      );
    }
    const driveRows = (await loadDrives(id)).filter(isActiveDrive);
    const axes = rowAxes(row);

    // De brain dobbelt, het model krijgt enkel de uitkomst. Alleen bij slapen: bij stilte blijft de Dynimo wakker.
    const dreaming = sleeping && random() < DREAM_CHANCE;

    await onStart?.();
    const { output } = await generateText({
      model: (await activeType2()).heavy.model,
      instructions: REFLECTION_INSTRUCTIONS,
      prompt: `Naam: ${row.name}
Kern-karakter: ${row.coreCharacter}
Geëvolueerd karakter: ${row.evolvedCharacter || "(nog niet)"}
${personalityText(row) || "Persoonlijkheid: (nog niet bepaald)"}${axes ? ` (assen: ie ${axes.ie.toFixed(2)}, sn ${axes.sn.toFixed(2)}, tf ${axes.tf.toFixed(2)}, jp ${axes.jp.toFixed(2)}, reactivity ${axes.reactivity.toFixed(2)}, expressiveness ${axes.expressiveness.toFixed(2)})` : ""}
Verstand: ${row.verstand === null ? "(nog niet bepaald)" : row.verstand.toFixed(2)}
Basisemotie: ${row.baseEmotion ?? "(nog niet bepaald)"}
${dreaming ? "Je droomt vannacht: vul dream in." : "Je droomt vannacht niet: dream is null."}
Actieve Drijfveren:
${driveRows.map((drive) => `- [id ${drive.id}] ${drive.kind}: ${drive.text}${drive.status ? ` (${drive.status})` : ""}`).join("\n") || "(geen)"}
Nieuwe herinneringen (oudste eerst):
<herinneringen>
${fresh.map((memory) => `- (indruk ${memory.impression}) ${memory.text}`).join("\n")}
</herinneringen>`,
      output: Output.object({ schema: reflectionSchema }),
    });

    const processedUntil = fresh[fresh.length - 1]!.createdAt; // ook na de uitbreiding: dezelfde timestamp
    return deps.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(dynimos).where(eq(dynimos.id, id)).for("update");
      // Een andere instantie was ons voor (of de Dynimo is gedood): niets schrijven.
      if (!locked || locked.lastReflectedAt?.getTime() !== row.lastReflectedAt?.getTime()) return false;

      const at = now();
      // Een Droom wint van de Ontwaakstemming enkel als hij strikt intenser is (zelfde regel als bij de Stemming: de zichtbare emotie wint).
      const dreamWins = dreaming && output.dream !== null && output.dream.intensity > output.wakeMood.intensity;
      const wakeMood = dreamWins
        ? { wakeMoodEmotion: output.dream!.emotion, wakeMoodIntensity: output.dream!.intensity }
        : { wakeMoodEmotion: output.wakeMood.emotion, wakeMoodIntensity: output.wakeMood.intensity };
      const lockedAxes = rowAxes(locked);
      const shifted = (value: number, shift: number) =>
        Math.min(1, Math.max(0, value + Math.min(AXIS_SHIFT_LIMIT, Math.max(-AXIS_SHIFT_LIMIT, shift))));
      await tx
        .update(dynimos)
        .set({
          evolvedCharacter: output.evolvedCharacter,
          ...(lockedAxes && {
            axisIe: shifted(lockedAxes.ie, output.axisShifts.ie),
            axisSn: shifted(lockedAxes.sn, output.axisShifts.sn),
            axisTf: shifted(lockedAxes.tf, output.axisShifts.tf),
            axisJp: shifted(lockedAxes.jp, output.axisShifts.jp),
            axisReactivity: shifted(lockedAxes.reactivity, output.axisShifts.reactivity),
            axisExpressiveness: shifted(lockedAxes.expressiveness, output.axisShifts.expressiveness),
          }),
          ...(locked.verstand !== null && { verstand: growVerstand(locked.verstand, output.verstandShift) }),
          // Is de Dynimo intussen alweer wakker, dan zou een Ontwaakstemming onterecht blijven staan: overslaan.
          ...(!locked.awakeSince && {
            ...wakeMood,
          }),
          lastReflectedAt: processedUntil,
        })
        .where(eq(dynimos.id, id));

      // Reflectie bij stilte (niet bij slapen, #91): de relatie met elke Persoon met een rij koelt een beetje af,
      // behalve wie aanwezig was tijdens de stilte (#94; zonder aanwezig: iedereen, huidig gedrag).
      if (!sleeping) {
        const relations = await tx.select().from(familiarities).where(eq(familiarities.dynimoId, id));
        for (const relation of relations) {
          if (aanwezig?.includes(relation.personId)) continue;
          await tx
            .update(familiarities)
            .set({ familiarity: updateFamiliarity({ current: relation.familiarity, event: "langeStilte", axes: { tf: 0.5, expressiveness: 0.5 } }) })
            .where(and(eq(familiarities.dynimoId, id), eq(familiarities.personId, relation.personId)));
        }
      }

      if (dreaming && output.dream) await tx.insert(dreams).values({ dynimoId: id, ...output.dream, createdAt: at });

      // Drijfveren: eerst sluiten/droppen (maakt plek), dan aanpassen, dan toevoegen. Ids moeten bij déze Dynimo
      // horen en actief zijn; anders negeren.
      const active = (await tx.select().from(drives).where(eq(drives.dynimoId, id))).filter((drive) =>
        isActiveDrive(drive as DriveRow),
      );
      const activeById = new Map(active.map((drive) => [drive.id, drive]));
      for (const { id: driveId, status } of output.drives.closeGoals) {
        const drive = activeById.get(driveId);
        if (!drive || drive.kind !== "doel") continue;
        await tx.update(drives).set({ status, updatedAt: at }).where(eq(drives.id, driveId));
        activeById.delete(driveId);
      }
      for (const { id: driveId } of output.drives.drop) {
        if (!activeById.has(driveId)) continue;
        await tx.update(drives).set({ droppedAt: at, updatedAt: at }).where(eq(drives.id, driveId));
        activeById.delete(driveId);
      }
      for (const add of output.drives.add) {
        const ofKind = [...activeById.values()].filter((drive) => drive.kind === add.kind);
        const text = add.text.trim();
        if (ofKind.some((drive) => drive.text.trim().toLowerCase() === text.toLowerCase())) continue;
        if (ofKind.length >= MAX_ACTIVE_PER_KIND) {
          console.warn(`Reflectie: geen plek voor een nieuwe ${add.kind} bij Dynimo ${id}; overgeslagen.`);
          continue;
        }
        const [inserted] = await tx
          .insert(drives)
          .values({
            dynimoId: id,
            kind: add.kind,
            text,
            status: add.kind === "doel" ? "actief" : null,
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        activeById.set(inserted!.id, inserted!);
      }
      // Assen/Verstand (en bij stilte de Vertrouwdheid) schuiven hierboven; het gezichtje ververst zijn kenmerken (#111).
      // ponytail: meldt ook als een shift toevallig 0 uitkomt (bv. axisShifts allemaal 0) — een overbodige melding
      // is onschuldig, een gemiste is niet.
      await notifyStateChange(tx, `${STATE_PREFIXES.kenmerken}${id}`);
      return true;
    });
  }

  // Reflectie van de wakkere Dynimo bij stilte: hij blijft wakker (geen wissel), maar meldt "kenmerken:<id>" als
  // assen/Verstand/Vertrouwdheid verschuiven (#111). Gooit nooit.
  // `aanwezig` (#94): Persoon-ids die tijdens de stilte in beeld waren; hun Vertrouwdheid daalt dan niet mee.
  // Met `deps.jobs` (#125): plant enkel een reflectie-job in (zelfde dedup-id als reflectAll) en geeft meteen true
  // terug; `hooks.onStart` is dan zinloos (de Type2-call gebeurt pas later, in de worker) en wordt genegeerd.
  async function reflect(hooks: { onStart?: () => void; aanwezig?: number[] } = {}): Promise<boolean> {
    try {
      const [awake] = await deps.db.select({ id: dynimos.id }).from(dynimos).where(isNotNull(dynimos.awakeSince));
      if (!awake) return false;
      if (deps.jobs) {
        await deps.jobs.enqueue(
          "reflectie",
          { dynimoId: awake.id, sleeping: false, aanwezig: hooks.aanwezig },
          { deduplication: { id: `reflectie:${awake.id}` } },
        );
        return true;
      }
      return await reflectDynimo(awake.id, hooks.onStart, false, hooks.aanwezig);
    } catch (error) {
      console.warn("Reflectie bij stilte faalde:", error instanceof Error ? error.message : error);
      return false;
    }
  }

  // Voert de Reflectie echt uit (#125): door de worker aangeroepen. Meldt start/einde op het toestandskanaal (de
  // agent luistert daar al, dynimo-watch.ts `routeNotifyPayload`); "einde" enkel als "start" ook gemeld is (anders
  // valt er niets te reflecteren, zie reflectDynimoInner). Gooit door bij een fout (i.t.t. reflect()): BullMQ herkanst.
  async function runReflection(id: number, options: { sleeping: boolean; aanwezig?: number[] }): Promise<void> {
    let started = false;
    try {
      await reflectDynimo(
        id,
        async () => {
          started = true;
          await notifyStateChange(deps.db, `${STATE_PREFIXES.reflectie}start:${id}`).catch((error) =>
            console.warn("Reflectie start melden faalde:", error instanceof Error ? error.message : error),
          );
        },
        options.sleeping,
        options.aanwezig,
      );
    } finally {
      if (started) {
        await notifyStateChange(deps.db, `${STATE_PREFIXES.reflectie}einde:${id}`).catch((error) =>
          console.warn("Reflectie einde melden faalde:", error instanceof Error ? error.message : error),
        );
      }
    }
  }

  // Van buitenaf (#125: de agent op basis van een NOTIFY van de worker) bijwerken van dezelfde teller die
  // reflectDynimo() intern gebruikt, zodat considerInitiative() ook een Reflectie in een ander proces respecteert.
  function noteReflection(id: number, running: boolean): void {
    if (running) {
      reflecting.set(id, (reflecting.get(id) ?? 0) + 1);
      return;
    }
    const left = (reflecting.get(id) ?? 0) - 1;
    if (left > 0) reflecting.set(id, left);
    else reflecting.delete(id);
  }

  // Per-Dynimo sessiestaat: mag niet doorsijpelen naar een ander (of nieuw) wezen.
  // ponytail: vervangt het hele sessie-object i.p.v. de velden leeg te maken (#114) — een beurt die zijn `s` al
  // vastlegde, blijft dan op zijn eigen (wees-)object schrijven i.p.v. op de nieuwe sessie. Zie de Session-comment.
  function resetSession(): void {
    session = newSession();
  }

  // Een andere Wakker-generatie (andere Dynimo of nieuwe awake_since) is een nieuwe sessie.
  function adopt(row: Dynimo): Dynimo {
    if (current?.id !== row.id || current.awakeSince?.getTime() !== row.awakeSince?.getTime()) {
      resetSession();
      current = row;
    }
    return current;
  }

  async function bringToLife(): Promise<Dynimo> {
    const born = await genesis();
    let slept: number[] = [];
    const row = await withWakeLock(async (tx) => {
      slept = await sleepAll(tx);
      const [inserted] = await tx
        .insert(dynimos)
        .values({ ...born.dynimo, voice: born.voice?.voice ?? null, voiceDescription: born.voice?.description ?? null, awakeSince: now() })
        .returning();
      await tx.insert(drives).values(driveRowsFor(inserted!.id, born.drives, now()));
      await notifyStateChange(tx, String(inserted!.id));
      return inserted!;
    });
    adopt(row);
    await reflectAll(slept);
    return row;
  }

  async function wake(id: number): Promise<Dynimo | null> {
    let slept: number[] = [];
    const row = await withWakeLock(async (tx) => {
      const [found] = await tx.select().from(dynimos).where(eq(dynimos.id, id));
      if (!found || found.awakeSince) return found ?? null;
      slept = await sleepAll(tx);
      const at = now();
      // Ontwaakstemming (uit de Reflectie) wordt de Stemming en is daarmee verbruikt.
      const wakeMood =
        found.wakeMoodEmotion !== null
          ? {
              moodValues: singleEmotionValues(found.wakeMoodEmotion as Emotion, found.wakeMoodIntensity ?? 0, baseEmotionOf(found) ?? undefined),
              moodAt: at,
              wakeMoodEmotion: null,
              wakeMoodIntensity: null,
            }
          : {};
      const [woken] = await tx.update(dynimos).set({ awakeSince: at, ...wakeMood }).where(eq(dynimos.id, id)).returning();
      await notifyStateChange(tx, String(id));
      return woken!;
    });
    const adopted = row && adopt(row);
    await reflectAll(slept);
    return adopted;
  }

  async function sleep(): Promise<void> {
    const slept = await withWakeLock(async (tx) => {
      const ids = await sleepAll(tx);
      await notifyStateChange(tx);
      return ids;
    });
    forgetBeing();
    await reflectAll(slept);
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
          model: (await activeType2()).heavy.model,
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
          model: (await activeType2()).heavy.model,
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
          model: (await activeType2()).heavy.model,
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
    {
      // Geen LLM-call: de richtwaarde van het archetype (zonder spreiding), of 0.5 zonder archetype (ticket #98).
      isMissing: async (row) => row.verstand === null,
      fill: async (row) => {
        const verstand = getArchetype(row.archetype)?.verstand ?? 0.5;
        // Race-veilig: enkel schrijven als een andere instantie er niet al Verstand op gezet heeft.
        const updated = await deps.db
          .update(dynimos)
          .set({ verstand })
          .where(and(eq(dynimos.id, row.id), isNull(dynimos.verstand)))
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
      // Assen/Verstand/Basisemotie vullen hierboven de kenmerken aan; het gezichtje ververst ze (#111).
      if (changed) {
        updatedRows++;
        await notifyStateChange(deps.db, `${STATE_PREFIXES.kenmerken}${listed.id}`);
      }
    }
    return updatedRows;
  }

  // Het geheugen is aanvullend: faalt het embedden, dan gaat het gesprek door zonder herinneringen.
  // Leeftijd = kalendertijd sinds born_at (ADR-0002), na het cachepunt want ze verandert.
  function ageMessage(being: Dynimo): SystemModelMessage {
    return { role: "system", content: `Leeftijd: ${formatAge(now().getTime() - being.bornAt.getTime())}` };
  }

  // "Aanwezig" (#94/#115, privacy-reviewfix): is de Gesprekspartner "geen-signaal" én `aanwezig` weggelaten
  // (undefined), dan is er geen enkel signaal en telt de eigenaar als aanwezig (huidig gedrag). Is minstens één van
  // beide wél een echt signaal — een aanwezig-lijst (ook leeg) of een expliciet "onbekende"/"persoon" Gesprekspartner
  // — dan telt enkel wie er echt is: een niet-herkende vreemde mag nooit de eigenaar als aanwezig krijgen (en dus
  // diens Spontane herinnering aanhalen). Enkel een bestaande eigenaar-rij lezen (geen insert).
  // `ownerId` (#109): al opgehaald door de aanroeper (hear()) i.p.v. hier nog eens de eigenaar te selecteren;
  // considerInitiative geeft hem niet mee en valt terug op zijn eigen getOwnerId()-lookup.
  async function presentPersonIds(gesprekspartner: Gesprekspartner, aanwezigOption: number[] | undefined, ownerId?: number): Promise<number[]> {
    if (gesprekspartner.soort === "geen-signaal" && aanwezigOption === undefined) {
      if (ownerId !== undefined) return [ownerId];
      const [owner] = await deps.db.select({ id: persons.id }).from(persons).where(eq(persons.owner, true));
      return owner ? [owner.id] : [];
    }
    const ids = new Set(aanwezigOption ?? []);
    if (gesprekspartner.soort === "persoon") ids.add(gesprekspartner.personId);
    return [...ids];
  }

  // `present` (#94): Herinneringen van deze Personen krijgen een kleine bonus in de ORDER BY (afstand min
  // RECALL_PRESENT_BONUS); geen filter, Herinneringen van anderen blijven ophaalbaar.
  // `embeddingPromise` (#109): de uiting wordt vóór/parallel met Type1 al ingebed door de aanroeper; een
  // embed-fout is daar al gelogd en geeft hier null (dan geen Herinneringen, zoals voorheen).
  async function recall(embeddingPromise: Promise<number[] | null>, dynimoId: number, present: number[], sessionMemoryIds: number[]): Promise<{ text: string; personId: number | null }[]> {
    const embedding = await embeddingPromise;
    if (!embedding) return [];
    try {
      const scope = sessionMemoryIds.length
        ? and(eq(memories.dynimoId, dynimoId), notInArray(memories.id, sessionMemoryIds))
        : eq(memories.dynimoId, dynimoId);
      const distance = cosineDistance(memories.embedding, embedding);
      // Kandidaten via de HNSW-index (`ORDER BY afstand LIMIT n`, iterative scan aan zodat de WHERE-filter
      // niet te weinig rijen oplevert); pas ná die indexscan herrangschikken met de aanwezig-bonus (#110).
      return await deps.db.transaction(async (tx) => {
        await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
        const candidates = tx.$with("recall_candidates").as(
          tx
            .select({ text: memories.text, personId: memories.personId, distance: distance.as("distance") })
            .from(memories)
            .where(scope)
            .orderBy(distance)
            .limit(RECALL_CANDIDATES),
        );
        // `+ 0` (i.p.v. kaal `candidates.distance`): relaxed_order levert de kandidaten slechts bij benadering
        // gesorteerd; een letterlijk gelijke ORDER BY-expressie laat de planner de binnenste sortering soms
        // doorgeven zonder de buitenste te herhalen. Deze expressie dwingt een echte herordening af.
        const ranking = present.length
          ? sql`(${candidates.distance}) - (case when ${inArray(candidates.personId, present)} then ${RECALL_PRESENT_BONUS}::real else 0 end)`
          : sql`(${candidates.distance}) + 0`;
        return tx.with(candidates).select({ text: candidates.text, personId: candidates.personId }).from(candidates).orderBy(ranking).limit(RECALL_LIMIT);
      });
    } catch (error) {
      console.warn("Herinneringen ophalen faalde:", error instanceof Error ? error.message : error);
      return [];
    }
  }

  // Kiest (pure kiezer) een Spontane herinnering uit de oude, vormende Herinneringen van een aanwezige Persoon
  // (#94: een Herinnering zonder Persoon hoort bij niemand en komt dus nooit in aanmerking); faalt stil naar null.
  // De kansworp gaat vóór de query: bij een gewone beurt (~3%) zit er zo meestal geen database-ronde op het kritieke pad.
  async function pickSpontaneous(dynimoId: number, axes: Axes, baseChance: number, present: number[]): Promise<SpontaneousCandidate | null> {
    if (present.length === 0 || random() >= spontaneousChance(axes, baseChance)) return null;
    try {
      const candidates = await deps.db
        .select({ id: memories.id, createdAt: memories.createdAt, impression: memories.impression, lastRecalledAt: memories.lastRecalledAt, text: memories.text })
        .from(memories)
        .where(and(eq(memories.dynimoId, dynimoId), inArray(memories.personId, present), gte(memories.impression, SPONTANEOUS_MIN_IMPRESSION), lte(memories.createdAt, new Date(now().getTime() - SPONTANEOUS_MIN_AGE_MS))))
        .orderBy(desc(memories.impression), desc(memories.createdAt))
        .limit(SPONTANEOUS_CANDIDATE_LIMIT);
      return pickSpontaneousMemory({ memories: candidates, now: now(), axes, rng: random, baseChance, chanceRolled: true });
    } catch (error) {
      console.warn("Spontane herinnering kiezen faalde:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  // `model` (#123): het Type2-model-id dat deze Herinnering schreef (hear()/onthoud-tool); null bij een
  // dashboard-Herinnering (addMemory) — die gaat buiten Type2 om.
  async function insertMemory(memoryText: string, dynimoId: number, impression: number, personId: number | null = null, model: string | null = null): Promise<number> {
    const { embedding } = await embed({ model: deps.embedder, value: memoryText });
    const [row] = await deps.db
      .insert(memories)
      .values({ dynimoId, personId, text: memoryText, embedding, createdAt: now(), impression, model })
      .returning({ id: memories.id });
    return row!.id;
  }

  // De expliciete onthoud-tool geeft de neutrale Indruk 0.5; de eindremember van `hear` geeft die van Type1 mee.
  // personId (#91) komt expliciet van de aanroeper (geen instance-state): elke beurt (en zijn onthoud-tool) sluit
  // over zijn eigen Gesprekspartner, zodat een overlappende tweede beurt hem niet kan overschrijven.
  // `s` (#114): de bij de beurt vastgelegde sessie (nooit de instance-brede `session`) — een achtergrond-remember
  // mag enkel naar zíjn eigen, mogelijk intussen vervangen sessie schrijven. Verplicht en apart genoemd (niet
  // `session`): anders bindt een vergeten argument stilzwijgend aan de instance-brede `session` en is de bug van
  // punt 1 zo weer terug.
  async function remember(memoryText: string, dynimoId = current?.id, impression = 0.5, personId: number | null = null, s: Session, model: string | null = null): Promise<boolean> {
    if (dynimoId === undefined) return false;
    try {
      let id: number;
      try {
        id = await insertMemory(memoryText, dynimoId, impression, personId, model);
      } catch (error) {
        // #107: de Gesprekspartner is intussen verwijderd/samengevoegd; de Herinnering dan zonder Persoon bewaren.
        // Bewust niet bij unknownSessionMemoryIds: ze hoorde bij een bekende Persoon, niet bij een latere leerKennen.
        if (personId === null || violatedForeignKey(error) !== "memories_person_id_persons_id_fk") throw error;
        console.warn(`Herinnering zonder Persoon opgeslagen: Persoon ${personId} bestaat niet (meer).`);
        id = await insertMemory(memoryText, dynimoId, impression, null, model);
      }
      s.sessionMemoryIds.push(id);
      // #92: apart bijgehouden zodat leerKennen precies de onbekende-Herinneringen van déze sessie kan koppelen.
      if (personId === null) s.unknownSessionMemoryIds.push(id);
      return true;
    } catch (error) {
      console.warn("Herinnering opslaan faalde:", error instanceof Error ? error.message : error);
      return false;
    }
  }

  // Verjaardag (#39): een sterke blije Emotie via dezelfde Stemming-verschuiving; de Basisemotie blijft ongemoeid.
  const birthdayBoostDue = (row: Dynimo) => isBirthday(row.bornAt, now()) && row.lastBirthdayBoostOn !== dayOf(now());
  function boostOnBirthday(row: Dynimo, stored: StoredMood, baseEmotion: Emotion | null): StoredMood {
    return birthdayBoostDue(row) ? applyDeltas(stored, baseEmotion, { blij: BIRTHDAY_DELTA }, now(), row.axisReactivity).next : stored;
  }

  // De vlag staat de hele verjaardag aan; Type2 beslist zelf of/hoe hij het vermeldt.
  function birthdayMessages(row: Dynimo): SystemModelMessage[] {
    if (!isBirthday(row.bornAt, now())) return [];
    const years = Number(dayOf(now()).slice(0, 4)) - Number(dayOf(row.bornAt).slice(0, 4));
    return [{ role: "system", content: `Vandaag is je verjaardag: je bent nu ${years} jaar oud. Jij beslist of en hoe je dat vermeldt.` }];
  }

  // Anders dan remember() géén sessionMemoryIds: een handmatig toegevoegde Herinnering moet meteen vindbaar zijn.
  // Reviewfix #94: een dashboard-Herinnering komt altijd van de eigenaar (er is geen Gesprekspartner om aan te koppelen).
  async function addMemory(id: number, text: string): Promise<boolean> {
    const [being] = await deps.db.select({ id: dynimos.id }).from(dynimos).where(eq(dynimos.id, id));
    if (!being) return false;
    await insertMemory(text, id, 0.5, await getOwnerId());
    return true;
  }

  async function removeMemory(id: number, memoryId: number): Promise<boolean> {
    // Scoped op dynimo_id: een memoryId van een andere Dynimo matcht niet.
    const deleted = await deps.db
      .delete(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.dynimoId, id)))
      .returning({ id: memories.id });
    return deleted.length > 0;
  }

  async function forceMood(id: number, emotion: Emotion, intensity: number): Promise<boolean> {
    const [row] = await deps.db.select().from(dynimos).where(eq(dynimos.id, id));
    if (!row) return false;
    return setMood(id, singleEmotionValues(emotion, intensity, baseEmotionOf(row) ?? undefined));
  }

  async function setAxes(id: number, axes: Axes): Promise<boolean> {
    return deps.db.transaction(async (tx) => {
      const updated = await tx
        .update(dynimos)
        .set({ axisIe: axes.ie, axisSn: axes.sn, axisTf: axes.tf, axisJp: axes.jp, axisReactivity: axes.reactivity, axisExpressiveness: axes.expressiveness })
        .where(eq(dynimos.id, id))
        .returning({ id: dynimos.id });
      // Payload "kenmerken:", zie notifyStateChange.
      if (updated.length > 0) await notifyStateChange(tx, `${STATE_PREFIXES.kenmerken}${id}`);
      return updated.length > 0;
    });
  }

  // Persoon "eigenaar" (#91): de default Gesprekspartner. Race-veilig via de partial unique index op `owner`
  // (ON CONFLICT DO NOTHING zonder target vangt elke unique-violation): wie hem als eerste inzet, wint.
  async function getOwnerId(): Promise<number> {
    const [existing] = await deps.db.select({ id: persons.id }).from(persons).where(eq(persons.owner, true));
    if (existing) return existing.id;
    await deps.db.insert(persons).values({ name: "eigenaar", owner: true }).onConflictDoNothing();
    const [owner] = await deps.db.select({ id: persons.id }).from(persons).where(eq(persons.owner, true));
    return owner!.id;
  }

  // leerKennen (#92/#93): maakt de Persoon aan en koppelt de onbekende-Herinneringen én onbekende gezichts-
  // embeddings van déze sessie (niet ouder dan UNKNOWN_FACE_MAX_AGE_MS, hoogstens MAX_FACE_EMBEDDINGS) eraan. Leegt
  // beide lijsten nadien: een latere, andere onbekende Gesprekspartner (nieuwe bezoeker) in dezelfde sessie mag ze
  // niet nog eens meekrijgen bij zíjn leerKennen.
  // `s` (#114): de bij déze beurt vastgelegde sessie — enkel díe wordt gelezen én geleegd, nooit de instance-brede
  // `session` (die kan intussen alweer een volgende Wakker-generatie zijn).
  async function leerKennenPersoon(naam: string, s: Session): Promise<{ id: number; name: string }> {
    // Reviewfix #109: een vorige beurt kan zijn eind-Herinnering nog op de achtergrond aan het opslaan zijn
    // (dan staat zijn id nog niet in unknownSessionMemoryIds); dat mag niet naar een latere, andere onbekende
    // Gesprekspartner doorschuiven. Wacht die achterstallige schrijfacties af vóór de snapshot. Geen deadlock:
    // déze beurt (de leerKennen-toolcall loopt nog) heeft zijn éigen eind-Herinnering nog niet als
    // achtergrondschrijfactie geregistreerd — dat gebeurt pas in hear()'s finally, ná deze toolcall.
    await settled();
    const linked = [...s.unknownSessionMemoryIds];
    // ponytail: koppelt alle nog-niet-vervallen onbekende embeddings aan déze ene nieuwe Persoon. Staan er twee
    // onbekende gezichten in de buffer (twee vreemden tegelijk in beeld), dan belanden ze allebei bij wie het eerst
    // zijn naam geeft. Upgradepad: embeddings pas koppelen als recognizeFaces ze aan hetzelfde gezicht toeschrijft
    // (bv. per-embedding clustering), of leerKennen een gezicht laten kiezen i.p.v. "alles wat onbekend is".
    const faces = s.unknownFaceEmbeddings.filter((entry) => now().getTime() - entry.at < UNKNOWN_FACE_MAX_AGE_MS).slice(-MAX_FACE_EMBEDDINGS);
    const created = await deps.db.transaction(async (tx) => {
      const [row] = await tx.insert(persons).values({ name: naam }).returning();
      if (linked.length) await tx.update(memories).set({ personId: row!.id }).where(inArray(memories.id, linked));
      if (faces.length) await tx.insert(faceEmbeddings).values(faces.map(({ embedding }) => ({ personId: row!.id, embedding })));
      return row!;
    });
    s.unknownSessionMemoryIds.length = 0;
    s.unknownFaceEmbeddings = [];
    return created;
  }

  /** Dashboard (#95): alle Personen met hun aantal gezichts-/stemprofielen en Herinneringen; eigenaar eerst, dan op aanmaakdatum. */
  async function listPersons(): Promise<PersonSummary[]> {
    const rows = await deps.db.select().from(persons).orderBy(desc(persons.owner), asc(persons.createdAt));
    const [faceCounts, voiceCounts, memoryCounts] = await Promise.all([
      deps.db.select({ personId: faceEmbeddings.personId, count: sql<number>`count(*)` }).from(faceEmbeddings).groupBy(faceEmbeddings.personId),
      deps.db.select({ personId: voiceProfilesTable.personId, count: sql<number>`count(*)` }).from(voiceProfilesTable).groupBy(voiceProfilesTable.personId),
      deps.db.select({ personId: memories.personId, count: sql<number>`count(*)` }).from(memories).where(isNotNull(memories.personId)).groupBy(memories.personId),
    ]);
    const toMap = (rows: { personId: number | null; count: number }[]) => new Map(rows.map((row) => [row.personId, Number(row.count)]));
    const faceMap = toMap(faceCounts);
    const voiceMap = toMap(voiceCounts);
    const memoryMap = toMap(memoryCounts);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      owner: row.owner,
      createdAt: row.createdAt,
      faceCount: faceMap.get(row.id) ?? 0,
      voiceCount: voiceMap.get(row.id) ?? 0,
      memoryCount: memoryMap.get(row.id) ?? 0,
    }));
  }

  /** Dashboard (#95): hernoemt een Persoon (zelfde naamvalidatie als leerKennen). False bij een ongeldige naam of een onbekende id; de eigenaar mag ook hernoemd worden. */
  async function renamePerson(id: number, name: string): Promise<boolean> {
    const parsed = NAAM_SCHEMA.safeParse(name);
    if (!parsed.success) return false;
    return deps.db.transaction(async (tx) => {
      const result = await tx.update(persons).set({ name: parsed.data }).where(eq(persons.id, id)).returning({ id: persons.id });
      // Payload "kenmerken:" zonder id (geen Dynimo-specifieke wijziging): de Vertrouwdheid-naam in het gezichtje kan
      // van deze Persoon zijn, ongeacht welke Dynimo wakker is.
      if (result.length > 0) await notifyStateChange(tx, STATE_PREFIXES.kenmerken);
      return result.length > 0;
    });
  }

  // mergePersons (#95): hoogstens MAX_FACE_EMBEDDINGS/MAX_VOICE_PROFILES per Persoon; na het verhuizen van removeId's
  // rijen naar keepId houden we enkel de nieuwste. Dezelfde trim als storeFaceEmbedding/addVoiceProfile, maar zonder
  // hun opslagvoorwaarden (hier verhuizen we bestaande rijen, geen nieuwe match).
  async function trimFaceEmbeddings(tx: Tx, personId: number): Promise<void> {
    const rows = await tx.select({ id: faceEmbeddings.id }).from(faceEmbeddings).where(eq(faceEmbeddings.personId, personId)).orderBy(desc(faceEmbeddings.createdAt), desc(faceEmbeddings.id));
    const excess = rows.slice(MAX_FACE_EMBEDDINGS);
    if (excess.length) await tx.delete(faceEmbeddings).where(inArray(faceEmbeddings.id, excess.map((row) => row.id)));
  }

  async function trimVoiceProfiles(tx: Tx, personId: number): Promise<void> {
    const rows = await tx
      .select({ id: voiceProfilesTable.id })
      .from(voiceProfilesTable)
      .where(eq(voiceProfilesTable.personId, personId))
      .orderBy(desc(voiceProfilesTable.createdAt), desc(voiceProfilesTable.id));
    const excess = rows.slice(MAX_VOICE_PROFILES);
    if (excess.length) await tx.delete(voiceProfilesTable).where(inArray(voiceProfilesTable.id, excess.map((row) => row.id)));
  }

  /**
   * Dashboard (#95): voegt removeId samen in keepId, in één transactie. Herinneringen en embeddings (gezicht + stem)
   * verhuizen, per soort blijven daarna hoogstens 5 over (de nieuwste). Vertrouwdheid: per Dynimo blijft de hoogste
   * van beide Personen over op keepId. Is removeId de eigenaar, dan gaat de owner-vlag naar keepId (hoogstens één
   * eigenaar blijft). False bij gelijke of onbekende ids.
   */
  async function mergePersons(keepId: number, removeId: number): Promise<boolean> {
    if (keepId === removeId) return false;
    return deps.db.transaction(async (tx) => {
      const [keep] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, keepId));
      const [remove] = await tx.select({ id: persons.id, owner: persons.owner }).from(persons).where(eq(persons.id, removeId));
      if (!keep || !remove) return false;

      await tx.update(memories).set({ personId: keepId }).where(eq(memories.personId, removeId));

      await tx.update(faceEmbeddings).set({ personId: keepId }).where(eq(faceEmbeddings.personId, removeId));
      await trimFaceEmbeddings(tx, keepId);

      await tx.update(voiceProfilesTable).set({ personId: keepId }).where(eq(voiceProfilesTable.personId, removeId));
      await trimVoiceProfiles(tx, keepId);

      const [keepFamiliarities, removeFamiliarities] = await Promise.all([
        tx.select({ dynimoId: familiarities.dynimoId, familiarity: familiarities.familiarity }).from(familiarities).where(eq(familiarities.personId, keepId)),
        tx.select({ dynimoId: familiarities.dynimoId, familiarity: familiarities.familiarity }).from(familiarities).where(eq(familiarities.personId, removeId)),
      ]);
      const highest = new Map(keepFamiliarities.map((row) => [row.dynimoId, row.familiarity]));
      for (const row of removeFamiliarities) highest.set(row.dynimoId, Math.max(row.familiarity, highest.get(row.dynimoId) ?? FAMILIARITY_DEFAULT));
      for (const [dynimoId, familiarity] of highest) {
        await tx
          .insert(familiarities)
          .values({ dynimoId, personId: keepId, familiarity })
          .onConflictDoUpdate({ target: [familiarities.dynimoId, familiarities.personId], set: { familiarity } });
      }

      await tx.delete(persons).where(eq(persons.id, removeId));
      if (remove.owner) await tx.update(persons).set({ owner: true }).where(eq(persons.id, keepId));
      // Payload "persons:" (zoals "mood:"/"voice:"): de agent herlaadt zijn Stemprofielen en gezichten (#95).
      await notifyStateChange(tx, STATE_PREFIXES.persons);
      return true;
    });
  }

  /**
   * Dashboard (#95): verwijdert een Persoon, enkel als `confirmedName` exact zijn naam is (zoals `kill`). Embeddings/
   * stemprofielen cascaden weg, Herinneringen blijven zonder Persoon (set null). False bij de eigenaar, een foute
   * naam of een onbekende id.
   */
  async function deletePerson(id: number, confirmedName: string): Promise<boolean> {
    // Naam vergelijken met de rij in de database, niet met wat de aanroeper meent (zoals kill).
    const [row] = await deps.db.select({ name: persons.name, owner: persons.owner }).from(persons).where(eq(persons.id, id));
    if (!row || row.owner || confirmedName !== row.name) return false;
    return deps.db.transaction(async (tx) => {
      const result = await tx.delete(persons).where(eq(persons.id, id)).returning({ id: persons.id });
      if (result.length === 0) return false;
      await notifyStateChange(tx, STATE_PREFIXES.persons);
      return true;
    });
  }

  /**
   * Dashboard (#95): wist gezichts-embeddings en Stemprofielen van een Persoon; de Persoon (en zijn Herinneringen,
   * Vertrouwdheid) blijft. False bij een onbekende id.
   */
  async function relearnPerson(id: number): Promise<boolean> {
    const [row] = await deps.db.select({ id: persons.id }).from(persons).where(eq(persons.id, id));
    if (!row) return false;
    await deps.db.transaction(async (tx) => {
      await tx.delete(faceEmbeddings).where(eq(faceEmbeddings.personId, id));
      await tx.delete(voiceProfilesTable).where(eq(voiceProfilesTable.personId, id));
      await notifyStateChange(tx, STATE_PREFIXES.persons);
    });
    return true;
  }

  // Vertrouwdheid van (dynimo, persoon), of 0.2 als die rij ontbreekt (nieuwe Dynimo, of nooit geschreven).
  async function familiarityRow(dynimoId: number, personId: number): Promise<number> {
    const [row] = await deps.db
      .select({ familiarity: familiarities.familiarity })
      .from(familiarities)
      .where(and(eq(familiarities.dynimoId, dynimoId), eq(familiarities.personId, personId)));
    return row?.familiarity ?? FAMILIARITY_DEFAULT;
  }

  // Upsert van (dynimo, persoon); false als de Dynimo intussen verwijderd is (FK-violation op dynimo_id). Een
  // FK-violation op person_id (de Gesprekspartner bestaat niet (meer)) breekt de beurt niet af: enkel de
  // Vertrouwdheid wordt dan niet geschreven.
  async function upsertFamiliarity(dynimoId: number, personId: number, familiarity: number): Promise<boolean> {
    try {
      await deps.db
        .insert(familiarities)
        .values({ dynimoId, personId, familiarity })
        .onConflictDoUpdate({ target: [familiarities.dynimoId, familiarities.personId], set: { familiarity } });
      return true;
    } catch (error) {
      const errorConstraint = violatedForeignKey(error);
      if (errorConstraint === undefined) throw error;
      if (errorConstraint === "familiarities_dynimo_id_dynimos_id_fk") return false;
      console.warn(`Vertrouwdheid niet opgeslagen: Persoon ${personId} bestaat niet (meer).`);
      return true;
    }
  }

  async function setFamiliarity(id: number, familiarity: number): Promise<boolean> {
    // Geen omliggende transactie: upsertFamiliarity vangt een FK-violation (verwijderde Dynimo) zelf af en
    // geeft dan false terug; in een expliciete transactie zou die afgevangen fout de transactie toch in de
    // aborted-toestand laten (elke volgende statement, ook de notify, zou dan alsnog falen).
    const ok = await upsertFamiliarity(id, await getOwnerId(), familiarity);
    // Payload "kenmerken:", zie notifyStateChange.
    if (ok) await notifyStateChange(deps.db, `${STATE_PREFIXES.kenmerken}${id}`);
    return ok;
  }

  /** Eigenaar-id zonder aan te maken (#111): enkel lezen, null zonder rij. */
  async function ownerIdReadOnly(): Promise<number | null> {
    const [existing] = await deps.db.select({ id: persons.id }).from(persons).where(eq(persons.owner, true));
    return existing?.id ?? null;
  }

  /** Vertrouwdheid voor het dashboard: van `personId` (default eigenaar) met deze Dynimo, 0.2 zonder rij. Leest de eigenaar enkel (#111). */
  async function familiarityOf(dynimoId: number, personId?: number): Promise<number> {
    const resolvedId = personId ?? (await ownerIdReadOnly());
    if (resolvedId === null) return FAMILIARITY_DEFAULT;
    return familiarityRow(dynimoId, resolvedId);
  }

  /** Naam van `personId` (default eigenaar), of null zonder rij; één lichte query, maakt de eigenaar nooit aan (#111). */
  async function personName(personId?: number): Promise<string | null> {
    const [row] =
      personId !== undefined
        ? await deps.db.select({ name: persons.name }).from(persons).where(eq(persons.id, personId))
        : await deps.db.select({ name: persons.name }).from(persons).where(eq(persons.owner, true));
    return row?.name ?? null;
  }

  async function voiceProfiles(): Promise<{ personId: number; profile: Uint8Array }[]> {
    return deps.db.select({ personId: voiceProfilesTable.personId, profile: voiceProfilesTable.profile }).from(voiceProfilesTable);
  }

  async function addVoiceProfile(personId: number, profile: Uint8Array): Promise<void> {
    await deps.db.transaction(async (tx) => {
      await tx.insert(voiceProfilesTable).values({ personId, profile });
      await trimVoiceProfiles(tx, personId);
    });
  }

  // Onthoudt een onbekende gezichts-embedding in de sessie (#93): hoogstens MAX_UNKNOWN_FACE_EMBEDDINGS, ouder dan
  // UNKNOWN_FACE_MAX_AGE_MS vervalt. leerKennen koppelt wat hier op dat moment nog binnen de vervaltijd valt.
  function rememberUnknownFace(s: Session, embedding: number[], at: number): void {
    s.unknownFaceEmbeddings = [...s.unknownFaceEmbeddings.filter((entry) => at - entry.at < UNKNOWN_FACE_MAX_AGE_MS), { embedding, at }].slice(-MAX_UNKNOWN_FACE_EMBEDDINGS);
  }

  // Reviewfix #93: enkel opslaan bij (a) een écht zekere match (afstand < FACE_SURE_MATCH_FACTOR × drempel) én
  // (b) de laatst opgeslagen embedding van deze Persoon is FACE_EMBEDDING_MIN_AGE_MS oud, of er is nog geen enkele
  // — anders niets (voorkomt bijna-kopieën van dezelfde zitting). Is dat zo: < 5 embeddings → toevoegen, op 5 → de
  // oudste vervangen. `for("update")` op de Persoon-rij serialiseert gelijktijdige matches voor dezelfde Persoon
  // (elke transactie wacht op de vorige), zodat er nooit meer dan 5 ontstaan.
  //
  // #117: de leeftijd-check vooraf met één lichte select (i.p.v. een in-memory cache) — blijft vanzelf correct bij
  // samenvoegen/verwijderen/opnieuw leren van Personen of een nieuwe instantie, want leest steeds de actuele rij.
  // Zo bespaart een herkenning binnen het uur de transactie (SELECT … FOR UPDATE) helemaal. De check binnen de
  // transactie blijft staan als vangnet tegen een race tussen instanties.
  // ponytail: één extra round-trip per zekere match per tick; een Map<personId, laatst-opgeslagen> erbovenop is
  // enkel de moeite waard als deze select zelf meetbaar gaat knellen.
  async function storeFaceEmbedding(personId: number, embedding: number[], distance: number): Promise<void> {
    if (distance >= faceMatchDistance * FACE_SURE_MATCH_FACTOR) return;
    const [newest] = await deps.db
      .select({ createdAt: faceEmbeddings.createdAt })
      .from(faceEmbeddings)
      .where(eq(faceEmbeddings.personId, personId))
      .orderBy(desc(faceEmbeddings.createdAt))
      .limit(1);
    if (newest && now().getTime() - newest.createdAt.getTime() < FACE_EMBEDDING_MIN_AGE_MS) return;
    await deps.db.transaction(async (tx) => {
      await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).for("update");
      const rows = await tx
        .select({ id: faceEmbeddings.id, createdAt: faceEmbeddings.createdAt })
        .from(faceEmbeddings)
        .where(eq(faceEmbeddings.personId, personId))
        .orderBy(asc(faceEmbeddings.createdAt), asc(faceEmbeddings.id));
      const newest = rows.at(-1);
      if (newest && now().getTime() - newest.createdAt.getTime() < FACE_EMBEDDING_MIN_AGE_MS) return;
      if (rows.length < MAX_FACE_EMBEDDINGS) {
        await tx.insert(faceEmbeddings).values({ personId, embedding });
        return;
      }
      await tx.delete(faceEmbeddings).where(eq(faceEmbeddings.id, rows[0]!.id));
      await tx.insert(faceEmbeddings).values({ personId, embedding });
    });
  }

  /**
   * Matcht gezichts-embeddings tegen bekende Personen (pgvector L2 `<->`, #93; zie DEFAULT_FACE_MATCH_DISTANCE voor
   * de afgeleide drempel). Onbekend (null): de embedding wordt in de sessie onthouden (rememberUnknownFace), zodat
   * een latere leerKennen hem kan koppelen. Adopteert eerst de wakkere Dynimo (net als considerInitiative), zodat
   * de sessie bij het juiste wezen hoort; is niemand wakker, dan wordt er niets onthouden (wel gewoon gematcht).
   */
  async function recognizeFaces(embeddings: number[][]): Promise<(number | null)[]> {
    // #117: al gefilterd op de wakkere (hoogstens 1); limit(1) maakt dat expliciet i.p.v. impliciet via de data.
    const [awake] = await deps.db.select().from(dynimos).where(isNotNull(dynimos.awakeSince)).limit(1);
    if (awake) adopt(awake);
    // #114: pas ná adopt() vastleggen — een wissel elders (bv. een lopende hear()) mag dit niet meer raken.
    const s = session;
    const at = now().getTime();
    const results: (number | null)[] = [];
    for (const embedding of embeddings) {
      const [nearest] = await deps.db
        .select({ personId: faceEmbeddings.personId, distance: l2Distance(faceEmbeddings.embedding, embedding) })
        .from(faceEmbeddings)
        .orderBy(l2Distance(faceEmbeddings.embedding, embedding))
        .limit(1);
      const distance = nearest ? Number(nearest.distance) : undefined;
      if (nearest && distance !== undefined && distance < faceMatchDistance) {
        results.push(nearest.personId);
        await storeFaceEmbedding(nearest.personId, embedding, distance);
      } else {
        results.push(null);
        if (awake) rememberUnknownFace(s, embedding, at);
      }
    }
    return results;
  }

  async function setVerstand(id: number, verstand: number): Promise<boolean> {
    return deps.db.transaction(async (tx) => {
      const updated = await tx.update(dynimos).set({ verstand }).where(eq(dynimos.id, id)).returning({ id: dynimos.id });
      // Payload "kenmerken:", zie notifyStateChange.
      if (updated.length > 0) await notifyStateChange(tx, `${STATE_PREFIXES.kenmerken}${id}`);
      return updated.length > 0;
    });
  }

  async function setArchetype(id: number, archetypeId: string): Promise<boolean> {
    const archetype = getArchetype(archetypeId);
    if (!archetype) return false;
    const { axes } = archetype;
    return deps.db.transaction(async (tx) => {
      const updated = await tx
        .update(dynimos)
        .set({
          archetype: archetype.id,
          baseEmotion: archetype.baseEmotion,
          axisIe: axes.ie,
          axisSn: axes.sn,
          axisTf: axes.tf,
          axisJp: axes.jp,
          axisReactivity: axes.reactivity,
          axisExpressiveness: axes.expressiveness,
          verstand: archetype.verstand,
        })
        .where(eq(dynimos.id, id))
        .returning({ id: dynimos.id });
      // Payload "kenmerken:", zie notifyStateChange.
      if (updated.length > 0) await notifyStateChange(tx, `${STATE_PREFIXES.kenmerken}${id}`);
      return updated.length > 0;
    });
  }

  async function setVoiceProfile(id: number, { voice, description }: { voice: string | null; description: string | null }): Promise<boolean> {
    return deps.db.transaction(async (tx) => {
      const updated = await tx.update(dynimos).set({ voice, voiceDescription: description }).where(eq(dynimos.id, id)).returning({ id: dynimos.id });
      // Payload "voice:" laat de agent enkel de stem verversen, zonder het lopende antwoord af te breken.
      if (updated.length > 0) await notifyStateChange(tx, `${STATE_PREFIXES.voice}${id}`);
      return updated.length > 0;
    });
  }

  async function setMood(id: number, values: MoodValues): Promise<boolean> {
    return deps.db.transaction(async (tx) => {
      const updated = await tx
        .update(dynimos)
        .set({ moodValues: values, moodAt: now() })
        .where(eq(dynimos.id, id))
        .returning({ id: dynimos.id });
      // Payload "mood:" laat de agent enkel het gezichtje verversen, zonder het lopende antwoord af te breken.
      if (updated.length > 0) await notifyStateChange(tx, `${STATE_PREFIXES.mood}${id}`);
      return updated.length > 0;
    });
  }

  async function* hear(text: string, options: { initiatief?: boolean; gesprekspartner?: Gesprekspartner; aanwezig?: number[] } = {}): AsyncIterable<BrainEvent> {
    // Elke beurt opnieuw: een ander proces (dashboard) kan intussen wisselen van Wakker Dynimo.
    const [awake] = await deps.db.select().from(dynimos).where(isNotNull(dynimos.awakeSince));
    if (!awake) {
      forgetBeing();
      return;
    }
    const being = adopt(awake);
    // #114: vastleggen ván nú af — deze beurt schrijft de rest van zijn duur enkel nog naar déze `s`, ook op de
    // achtergrond en ook als `session` intussen (door een wissel) alweer een andere generatie is.
    const s = session;
    // Embedding van de uiting (#109): start meteen, parallel met de rest van de beurt; recall() krijgt hem
    // straks aangereikt i.p.v. zelf te embedden. Een fout wordt hier al gelogd en geeft null (dan geen
    // Herinneringen, zoals voorheen); dit .then-paar zorgt dat de promise zelf nooit afwijst (geen unhandled
    // rejection, ook niet als een vroege return hem nooit uitleest, bv. negeren of niemand wakker).
    const embeddingPromise = embed({ model: deps.embedder, value: text }).then(
      (result) => result.embedding,
      (error: unknown): null => {
        console.warn("Uiting embedden faalde:", error instanceof Error ? error.message : error);
        return null;
      },
    );
    // Weggelaten telt hetzelfde als expliciet "geen-signaal" (#115).
    const gesprekspartner: Gesprekspartner = options.gesprekspartner ?? { soort: "geen-signaal" };
    // getOwnerId en loadDrives hangen niet van elkaar af (#109): parallel. loadDrives moet vóór Type1 klaar zijn
    // (driveRows zit in zijn context); getOwnerId enkel als er straks ook echt een eigenaar-fallback nodig is
    // (Gesprekspartner "geen-signaal") — anders (een expliciete, ook onbekende, Gesprekspartner) precies als
    // voorheen geen eigenaar-lookup. Die ene ownerId dient meteen ook presentPersonIds verderop (geen dubbele
    // lookup per beurt).
    const [ownerId, driveRows] = await Promise.all([gesprekspartner.soort === "geen-signaal" ? getOwnerId() : Promise.resolve(undefined), loadDrives(awake.id)]);
    // Persoon van deze beurt (#91/#115): meegegeven Gesprekspartner ("onbekend" = null), anders de eigenaar. Ook bij
    // initiatief: die krijgt de eigenaar tenzij een Gesprekspartner is meegegeven. Lokaal (geen instance-state):
    // een overlappende tweede beurt (bv. initiatief) mag deze niet kunnen overschrijven.
    // `let`: leerKennen (#92) bindt de rest van déze beurt aan de nieuw aangemaakte Persoon.
    let personId = gesprekspartner.soort === "persoon" ? gesprekspartner.personId : gesprekspartner.soort === "onbekend" ? null : ownerId!;
    const baseEmotion = baseEmotionOf(awake);
    const stored = storedMoodOf(awake);
    const boosted = boostOnBirthday(awake, stored, baseEmotion);
    const before = currentMood(boosted, baseEmotion, now(), awake.axisReactivity);
    const context = [
      personalityText(awake),
      drivesPromptBlock(driveRows),
      `Huidige stemming (0–100, ruststand 50: hoger is sterker dan normaal, lager is minder dan normaal): ${EMOTIONS.map((emotion) => `${emotion} ${Math.round(before.values[emotion])}`).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");
    // Type1 is een reflex: faalt hij, dan antwoordt Type2 toch. Zonder delta's blijft de Stemming ongemoeid (het
    // mood-event toont dan de bestaande Stemming of Basisemotie).
    const axes = rowAxes(awake);
    // Standpunt (opinion.ts): een Drijfveer die duidelijk raakt aan de uiting; een Ergernis raakt ook boos, via dezelfde delta's.
    // random()-aanroep #1 (vaste volgorde t.o.v. decideBehavior/pickSpontaneous/droom-worp verderop): niet verplaatsen.
    let opinionMessage: SystemModelMessage[] = [];
    let opinionBoos = 0;
    if (!options.initiatief) {
      s.turnCount++;
      const opinion = axes
        ? decideOpinion({ drives: driveRows, utteranceMatches: matchDrives(text, driveRows), axes, rng: random, lastOpinionTurnsAgo: s.lastOpinionTurn === undefined ? undefined : s.turnCount - s.lastOpinionTurn })
        : { kind: "geen" as const };
      const drive = driveRows.find((row) => row.id === opinion.driveId);
      const prompt = drive && opinionPrompt(opinion.kind, drive);
      if (drive && prompt) {
        s.lastOpinionTurn = s.turnCount;
        opinionMessage = [{ role: "system", content: prompt }];
        if (drive.kind === "ergernis") opinionBoos = OPINION_BOOS_DELTA;
      }
    }
    const canLook = deps.lookFrame !== undefined;
    // Een initiatiefbeurt verbruikt pendingLook meteen (ADR-0019: hoogstens één Kijk per aanleiding); zonder
    // lookFrame-dep nooit kijken, ook al stond de vlag klaar (considerInitiative weet niets van canLook).
    const initiatiefKijken = canLook && s.pendingLook;
    if (options.initiatief) s.pendingLook = false;
    // #114: pas hier verbruikt (niet al bij de initiatiefcheck): deze initiatiefbeurt vroeg zelf al naar de naam
    // (aanleidingText "onbekend"), dus askedName mag niet nog eens de UNKNOWN_NAME_PROMPT triggeren.
    if (options.initiatief && s.pendingAskName) {
      s.askedName = true;
      s.pendingAskName = false;
    }

    // Parallel met Type1 (classify): hangen enkel van personId/opties af, niet van Type1's uitkomst (#109). Elke
    // promise krijgt meteen een no-op .catch zodat een vroege return (negeren, gedood tijdens de mood-update)
    // hem niet als unhandled rejection achterlaat; de "echte" afhandeling gebeurt bij het latere await.
    const safe = <T>(promise: Promise<T>): Promise<T> => {
      promise.catch(() => {});
      return promise;
    };
    const familiarityPromise = safe(personId === null ? Promise.resolve(FAMILIARITY_DEFAULT) : familiarityRow(being.id, personId));
    const speakerPersonPromise = safe(
      personId === null
        ? Promise.resolve(undefined)
        : deps.db.select({ name: persons.name, owner: persons.owner }).from(persons).where(eq(persons.id, personId)).then((rows) => rows[0]),
    );
    const presentPromise = safe(
      options.aanwezig?.length
        ? deps.db.select({ name: persons.name, owner: persons.owner }).from(persons).where(inArray(persons.id, options.aanwezig))
        : Promise.resolve([]),
    );
    // "Aanwezig" (#94): de ruwe Gesprekspartner (niet de al op de eigenaar teruggevallen `personId`) — een
    // expliciet "onbekende" Gesprekspartner mag zelf geen eigenaar-fallback triggeren. Stuurt de recall-bonus en
    // de Spontane herinnering.
    const presentIdsPromise = safe(presentPersonIds(gesprekspartner, options.aanwezig, ownerId));
    // Modelwissel-experiment (#123): welk Type2-model deze beurt gebruikt, staat pas vast ná Intent (hieronder);
    // het lezen van de instelling zelf hangt daar niet van af, en start dus hier al parallel met Type1 (#109).
    const type2Promise = safe(activeType2());

    const { deltas: type1Deltas, indruk, intent, kijken } = await (options.initiatief
      ? Promise.resolve<Type1Result>({ deltas: {}, indruk: 0.2, intent: "simpel", kijken: initiatiefKijken })
      : classify(deps.type1, text, context, canLook)
    ).catch((error: unknown): Type1Result => {
      console.warn("Type1 faalde, val terug op geen delta/simpel:", error instanceof Error ? error.message : error);
      return { deltas: {}, indruk: 0, intent: "simpel", kijken: false };
    });

    const deltas: MoodDeltas = opinionBoos ? { ...type1Deltas, boos: (type1Deltas.boos ?? 0) + opinionBoos } : type1Deltas;
    const { mood, next } = applyDeltas(boosted, baseEmotion, deltas, now(), awake.axisReactivity);
    // ponytail: last-writer-wins zonder guard; volstaat bij één wakkere Dynimo. Guard op mood_at zodra er ooit
    // meerdere schrijvers tegelijk zijn.
    const birthdayBoost = birthdayBoostDue(awake);
    // Emotie stuurt gedrag (behavior.ts). Een spontane uiting (initiatief) wordt nooit genegeerd of ingekort.
    // Vóór de Vertrouwdheid, die "genegeerd" of "beurt" nodig heeft. random()-aanroep #2.
    const behavior = options.initiatief || !axes ? "normaal" : decideBehavior({ values: mood.values, axes, rng: random, vorigeGenegeerd: s.lastIgnored });
    if (!options.initiatief) s.lastIgnored = behavior === "negeren";
    // Vertrouwdheid (familiarity.ts): een beurt telt, een positieve beurt extra; een genegeerde beurt telt niet als
    // beurt. Onbekend (personId null, #91): altijd 0.2, nooit opgeslagen.
    const familiarityAxes = axes ?? { tf: 0.5, expressiveness: 0.5 };
    const startFamiliarity = await familiarityPromise;
    let familiarity = startFamiliarity;
    if (!options.initiatief && personId !== null) {
      if (behavior === "negeren") familiarity = updateFamiliarity({ current: familiarity, event: "genegeerd", axes: familiarityAxes });
      else {
        familiarity = updateFamiliarity({ current: familiarity, event: "beurt", axes: familiarityAxes });
        if ((type1Deltas.blij ?? 0) >= FAMILIARITY_POSITIVE_DELTA) familiarity = updateFamiliarity({ current: familiarity, event: "positief", axes: familiarityAxes });
      }
    }
    if ((next !== stored && next) || birthdayBoost) {
      const updated = await deps.db
        .update(dynimos)
        .set({
          ...(next && { moodValues: next.values, moodAt: next.at }),
          ...(birthdayBoost && { lastBirthdayBoostOn: dayOf(now()) }),
        })
        .where(eq(dynimos.id, being.id))
        .returning({ id: dynimos.id });
      // Een andere instantie kan de Dynimo intussen gedood hebben: dan is niemand wakker.
      if (updated.length === 0) {
        forgetBeing();
        return;
      }
    }
    if (personId !== null && familiarity !== startFamiliarity && !(await upsertFamiliarity(being.id, personId, familiarity))) {
      forgetBeing();
      return;
    }

    yield { type: "mood", emotion: mood.emotion, intensity: mood.intensity, values: mood.values };
    const soundKind = soundKindFor(mood.emotion);
    let soundYielded = false;
    if (isVisibleMoodChange(before, mood) && soundKind) {
      soundYielded = true;
      yield { type: "sound", kind: soundKind };
    }

    const userMessage: ModelMessage = { role: "user", content: text };
    if (behavior === "negeren") {
      // Zichtbaar op het gezichtje via de (boze) Stemming plus een non-verbaal geluid; geen antwoord en geen TTS.
      if (soundKind && !soundYielded) yield { type: "sound", kind: soundKind };
      s.workingMemory.push(userMessage, { role: "assistant", content: "(je negeert dit)" });
      trimWorkingMemory(s.workingMemory);
      // Achtergrond (#109): de stream eindigt niet meer op deze opslag; remember() vangt zijn eigen fouten al.
      trackBackground(remember(`Gesprekspartner: ${text}\n${being.name} negeert dit.`, being.id, indruk, personId, s));
      return;
    }

    // #92: de eerste keer dat de onbekende Gesprekspartner echt een antwoord krijgt, vraagt Type2 vriendelijk zijn
    // naam; een weigering wordt (askedName blijft true) deze sessie niet opnieuw gevraagd.
    const askNameNow = personId === null && !s.askedName;
    if (askNameNow) s.askedName = true;

    // Kijken (ADR-0019): Type1 besliste al; een fout bij het ophalen telt als geen beeld en breekt de beurt nooit.
    const haalFrame = (): Promise<Frame | null> =>
      (deps.lookFrame?.() ?? Promise.resolve(null)).catch((error: unknown) => {
        console.warn("Frame ophalen faalde:", error instanceof Error ? error.message : error);
        return null;
      });
    const frame = kijken ? await haalFrame() : null;
    if (frame) yield { type: "kijk" };
    const promptMessage: ModelMessage = frame
      ? { role: "user", content: [{ type: "text", text }, { type: "file", data: frame.data, mediaType: frame.mediaType }] }
      : userMessage;
    const noFrameMessage: SystemModelMessage[] = kijken && !frame ? [{ role: "system", content: NIETS_ZIEN }] : [];

    // Kijk-tool (ADR-0019, vangnet): enkel aangeboden als Type1 zelf geen beeld meestuurde (canLook && !kijken); zei
    // Type1 al ja (ook met een null-frame), dan wordt nooit een tweede keer gekeken. Guard binnen deze beurt: een
    // tweede aanroep (multi-step) roept lookFrame niet nog eens aan.
    let kijkGebruikt = false;
    const kijkTools: ToolSet = canLook && !kijken
      ? {
          kijk: tool({
            description:
              "Kijkt door je camera en geeft het huidige beeld. Gebruik dit als de Gesprekspartner je iets toont of vraagt wat je ergens van vindt en je daarvoor moet zien.",
            inputSchema: z.object({}),
            execute: async (): Promise<{ frame: Frame | null; alGekeken?: boolean }> => {
              if (kijkGebruikt) return { frame: null, alGekeken: true };
              kijkGebruikt = true;
              return {
                frame: await haalFrame(),
              };
            },
            toModelOutput: ({ output }) =>
              output.alGekeken
                ? { type: "text", value: "Je hebt deze beurt al gekeken." }
                : output.frame
                  ? {
                      type: "content",
                      value: [
                        { type: "text", text: "Dit zie je nu door je camera." },
                        { type: "file", data: { type: "data", data: output.frame.data }, mediaType: output.frame.mediaType },
                      ],
                    }
                  : { type: "text", value: NIETS_ZIEN },
          }),
        }
      : {};

    // leerKennen (#92): enkel aangeboden als de Gesprekspartner van déze beurt onbekend is. `personId` wordt bij
    // succes herbonden, zodat de rest van deze beurt (waaronder de eind-Herinnering) de nieuwe Persoon krijgt.
    // Guard binnen deze beurt: een tweede aanroep (multi-step) maakt geen tweede Persoon.
    let leerKennenGebruikt = false;
    const leerKennenTools: ToolSet =
      personId === null
        ? {
            leerKennen: tool({
              description: "Maakt een nieuwe Persoon aan voor wie nu met je praat, zodra die zijn naam geeft.",
              inputSchema: z.object({ naam: NAAM_SCHEMA }),
              execute: async ({ naam }): Promise<{ personId: number; naam: string } | { algekend: true }> => {
                if (leerKennenGebruikt) return { algekend: true };
                leerKennenGebruikt = true;
                const created = await leerKennenPersoon(naam, s);
                personId = created.id;
                return { personId: created.id, naam: created.name };
              },
            }),
          }
        : {};

    // Modelwissel-experiment (#123): licht of zwaar zoals Type1's Intent besliste; de select zelf liep al parallel
    // met Type1 hierboven (type2Promise), enkel de keuze licht/zwaar hangt van `intent` af.
    const type2Choice = intent === "complex" ? (await type2Promise).heavy : (await type2Promise).light;

    // Tools van deze beurt (#91): de onthoud-tool sluit over de Gesprekspartner van déze beurt, niet over instance-state.
    // `type2Choice.id` (#123): de onthoud-tool schrijft ook een Herinnering, dus ook die krijgt het model van déze beurt.
    const turnTools = createTools({ now, remember: (memoryText: string) => remember(memoryText, being.id, undefined, personId, s, type2Choice.id) });

    // Naam van de Gesprekspartner (#92): bekend (met owner-vlag) of onbekend. Al gestart parallel met Type1 (#109).
    const speakerPerson = await speakerPersonPromise;

    // Aanwezige Personen (#93): onbekende ids (intussen verwijderd, of nooit bestaan) worden overgeslagen. Al
    // gestart parallel met Type1 (#109).
    const present = await presentPromise;

    // Al gestart parallel met Type1 (#109); zie presentPersonIds hierboven voor wat dit precies stuurt.
    const presentIds = await presentIdsPromise;

    const recalled = await recall(embeddingPromise, being.id, presentIds, s.sessionMemoryIds);
    // Discretieregel (#94): naam bij elke opgehaalde Herinnering van een andere (bekende) Persoon dan de
    // Gesprekspartner; de regel zelf enkel als zo'n Herinnering er ook echt bij zit.
    const otherPersonIds = [...new Set(recalled.map((memory) => memory.personId).filter((id): id is number => id !== null && id !== personId))];
    const otherPersons = otherPersonIds.length
      ? await deps.db.select({ id: persons.id, name: persons.name, owner: persons.owner }).from(persons).where(inArray(persons.id, otherPersonIds))
      : [];
    const labelById = new Map(otherPersons.map((person) => [person.id, person.owner ? "eigenaar" : person.name]));
    const recalledForPrompt = recalled.map((memory) => ({ text: memory.text, label: memory.personId !== null ? (labelById.get(memory.personId) ?? null) : null }));
    const discretionMessage: SystemModelMessage[] = labelById.size ? [DISCRETION_MESSAGE] : [];
    // Spontane herinnering: bij initiatief die van considerInitiative (al in `text`), anders heel zelden een aanleiding.
    let spontaneousId = options.initiatief ? s.pendingSpontaneousId : undefined;
    if (options.initiatief) s.pendingSpontaneousId = undefined;
    const dreamToMark = options.initiatief ? s.pendingDreamId : undefined;
    if (options.initiatief) s.pendingDreamId = undefined;
    let spontaneousPromptMessage: SystemModelMessage[] = [];
    if (!options.initiatief && axes) {
      const picked = await pickSpontaneous(being.id, axes, SPONTANEOUS_TURN_CHANCE, presentIds);
      if (picked) {
        spontaneousId = picked.id;
        spontaneousPromptMessage = [spontaneousPrompt(picked.text)];
      }
    }
    const [dream] = random() < DREAM_RECALL_CHANCE
      ? await deps.db.select({ text: dreams.text }).from(dreams).where(eq(dreams.dynimoId, being.id)).orderBy(desc(dreams.createdAt), desc(dreams.id)).limit(1)
      : [];

    const stable: SystemModelMessage = {
      role: "system",
      content: buildStableSystemPrompt(awake, driveRows),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };

    // #113: promptvolgorde voor de cache van de provider — vaste systeemtekst (`stable`, met cachebreakpoint)
    // vooraan, dan de geschiedenis (Werkgeheugen, ongewijzigd per beurt zolang de bovengrens niet knipt), en pas
    // daarna de wisselende context (leeftijd, Stemming, Vertrouwdheid, ...), vlak vóór de laatste uiting. Zo blijft
    // het gecachete deel (stabiel + geschiedenis) een herbruikbaar voorvoegsel; alleen het staartje verandert.
    // Als los system-bericht (niet in de laatste user-uiting): zowel Anthropic als OpenAI accepteren system-
    // berichten die niet vooraan staan (geverifieerd in de geïnstalleerde @ai-sdk/anthropic en @ai-sdk/openai:
    // Anthropic via de mid-conversation-system-beta, OpenAI zonder bijzondere behandeling) — vandaar
    // `allowSystemInMessages: true` i.p.v. tekst-parts in het laatste user-bericht.
    const contextMessages: SystemModelMessage[] = [
      ageMessage(being),
      ...birthdayMessages(awake),
      moodMessage(mood, axes?.expressiveness ?? 0.5),
      familiarityMessage(familiarity),
      speakerMessage(speakerPerson),
      ...(aanwezigMessage(present) ? [aanwezigMessage(present)!] : []),
      ...(askNameNow ? [UNKNOWN_NAME_PROMPT] : []),
      ...(BEHAVIOR_PROMPTS[behavior] ? [BEHAVIOR_PROMPTS[behavior]] : []),
      ...opinionMessage,
      ...discretionMessage,
      recallPrompt(recalledForPrompt),
      ...spontaneousPromptMessage,
      ...(dream ? [dreamPrompt(dream.text)] : []),
      ...noFrameMessage,
    ];

    const model = type2Choice.model;
    // Tweede Anthropic-cachebreakpoint op het laatste geschiedenisbericht: zonder deze marker cachet Anthropic
    // (in tegenstelling tot OpenAI's automatische prefix-cache) alleen wat vóór een expliciete breakpoint staat,
    // dus zonder deze tweede marker blijft enkel `stable` gecached en niet de (groeiende) geschiedenis erna. Kopie
    // van het laatste bericht, niet muteren: s.workingMemory zelf mag geen providerOptions van deze beurt krijgen.
    const history: ModelMessage[] =
      typeof model !== "string" && model.provider.startsWith("anthropic") && s.workingMemory.length > 0
        ? [
            ...s.workingMemory.slice(0, -1),
            { ...s.workingMemory.at(-1)!, providerOptions: { ...s.workingMemory.at(-1)!.providerOptions, anthropic: { cacheControl: { type: "ephemeral" } } } },
          ]
        : s.workingMemory;

    const abort = new AbortController();
    const result = streamText({
      abortSignal: abort.signal,
      model,
      instructions: [stable],
      messages: [...history, ...contextMessages, promptMessage],
      allowSystemInMessages: true,
      tools: { ...turnTools, ...kijkTools, ...leerKennenTools },
      // Genoeg stappen om een tool te gebruiken en daarna het resultaat te verwoorden.
      stopWhen: isStepCount(5),
    });

    let full = "";
    // Spraakgeluid: vooraf gekozen en als directe eerste mini-chunk verstuurd (geen wachten op tekstlengte);
    // `full` (Herinnering/Werkgeheugen) blijft de schone tekst.
    let soundDecided = false;
    // Pauzes (interpunctie) per zin vanaf de tweede zin; de eerste zin gaat ongebufferd door.
    const pacing = axes ? pacingFor({ values: mood.values, expressiveness: axes.expressiveness }) : null;
    const pacer = createPacer(pacing?.pauseLevel ?? 0, pacing?.halting);
    function* emitText(delta: string): Generator<BrainEvent> {
      const paced = pacer.push(delta);
      if (paced) yield { type: "text", delta: paced };
    }
    function* soundFirst(): Generator<BrainEvent> {
      if (soundDecided) return;
      soundDecided = true;
      const sound = axes ? pickSpeechSound({ values: mood.values, axes, rng: random, isShort: behavior === "kort", previous: s.lastSpeechSound }) : null;
      if (!sound) return;
      s.lastSpeechSound = sound;
      yield { type: "text", delta: `${sound} ` };
    }
    function* flushPacer(): Generator<BrainEvent> {
      const rest = pacer.flush();
      if (rest) yield { type: "text", delta: rest };
    }
    // "interrupted" tot het tegendeel bewezen is: stopt de consument vroegtijdig (barge-in), dan
    // draait enkel de finally hieronder.
    let outcome: "completed" | "failed" | "interrupted" = "interrupted";
    try {
      // fullStream i.p.v. textStream: die laatste slikt providerfouten stil in.
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") {
          full += part.text;
          yield* soundFirst();
          yield* emitText(part.text);
        }
        if (part.type === "tool-call") {
          yield* flushPacer();
          yield { type: "tool-call", toolName: part.toolName, input: part.input };
        }
        if (part.type === "tool-result") {
          // Kijk-tool: nooit de camerabytes naar de consument lekken via het BrainEvent.
          const kijkFrame = part.toolName === "kijk" ? (part.output as { frame: Frame | null }).frame : null;
          if (kijkFrame) yield { type: "kijk" };
          const output = part.toolName === "kijk" ? { gezien: kijkFrame !== null } : part.output;
          yield { type: "tool-result", toolName: part.toolName, output };
          // #92: leerKennen slaagde (niet bij een herhaalde aanroep, "algekend"); de agent kan hierop het
          // stemprofiel beginnen opbouwen.
          if (part.toolName === "leerKennen" && output && typeof output === "object" && "personId" in output) {
            const { personId: newPersonId, naam } = output as { personId: number; naam: string };
            yield { type: "persoon", personId: newPersonId, naam };
          }
        }
        if (part.type === "tool-error") {
          const message = part.error instanceof Error ? part.error.message : String(part.error);
          yield { type: "tool-result", toolName: part.toolName, output: { error: message } };
        }
      }
      yield* flushPacer();
      outcome = "completed";
    } catch (error) {
      outcome = "failed";
      throw error;
    } finally {
      // Onderbroken of mislukt: de generatie mag niet doorlopen (kosten).
      if (outcome !== "completed") abort.abort();
      // Een mislukte beurt komt nergens in; een onderbroken beurt wel, met wat al gezegd was.
      if (outcome === "completed") {
        s.workingMemory.push(userMessage, ...stripBeelden(await result.responseMessages));
      } else if (outcome === "interrupted" && full) {
        s.workingMemory.push(userMessage, { role: "assistant", content: full });
      }
      trimWorkingMemory(s.workingMemory);
      // Achtergrond (#109): de stream eindigt niet meer op deze opslag. personId nu vastleggen (leerKennen kan
      // hem tijdens deze beurt al herbonden hebben; latere beurten mogen déze niet meer wijzigen). Elke stap
      // vangt en logt zijn eigen fout, zodat één mislukking de andere twee niet overslaat.
      const personIdAtEnd = personId;
      trackBackground(
        (async () => {
          if (outcome === "completed" && spontaneousId !== undefined) {
            try {
              await deps.db.update(memories).set({ lastRecalledAt: now() }).where(eq(memories.id, spontaneousId));
            } catch (error) {
              console.warn("Spontane herinnering markeren faalde:", error instanceof Error ? error.message : error);
            }
          }
          if (outcome === "completed" && dreamToMark !== undefined) {
            try {
              await deps.db.update(dreams).set({ toldAt: now() }).where(eq(dreams.id, dreamToMark));
            } catch (error) {
              console.warn("Droom markeren faalde:", error instanceof Error ? error.message : error);
            }
          }
          if (outcome !== "failed" && full.trim()) {
            await remember(options.initiatief ? `${being.name}: ${full}` : `Gesprekspartner: ${text}\n${being.name}: ${full}`, being.id, indruk, personIdAtEnd, s, type2Choice.id);
          }
        })(),
      );
    }
  }

  // Alles wat deze instantie over het wezen weet; na verwijdering mag niets doorsijpelen naar een nieuw wezen.
  function forgetBeing(): void {
    current = undefined;
    resetSession();
  }

  async function kill(id: number, confirmedName: string): Promise<Epitaph | null> {
    // Naam vergelijken met de rij in de database, niet met de sessie van deze instantie.
    const [being] = await deps.db.select().from(dynimos).where(eq(dynimos.id, id));
    if (!being || confirmedName !== being.name) return null;

    // (1) Aparte, finale Type2-call: de laatste woorden, niet een bestaande reflectie.
    // Faalt die, dan wordt er bewust niets verwijderd: geen Grafschrift zonder laatste woorden.
    const { text: farewellReflection } = await generateText({
      model: (await activeType2()).heavy.model,
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

  function aanleidingText(aanleiding: Aanleiding): string {
    if (aanleiding.soort === "terug") return "de Gesprekspartner is net terug in beeld na een tijd weg te zijn geweest";
    if (aanleiding.soort === "onbekend") return "er is iemand die je nog niet kent";
    return `er verscheen net iets nieuws in beeld: ${aanleiding.object}`;
  }

  async function considerInitiative(aanleiding?: Aanleiding, options: { aanwezig?: number[] } = {}): Promise<string | null> {
    const [awake] = await deps.db.select().from(dynimos).where(isNotNull(dynimos.awakeSince));
    if (!awake) return null;
    if (reflecting.has(awake.id)) return null;
    adopt(awake); // wisselen wist de pending-ids (en askedName) van de vorige Dynimo vóór we die van deze lezen
    // #114: vastleggen ná adopt() — een wissel die tijdens de (async) Type1-call gebeurt, mag deze check niet meer raken.
    const s = session;
    // #92: is er deze sessie al naar de naam gevraagd, dan lokt "onbekend" geen nieuwe Type1-call meer uit.
    if (aanleiding?.soort === "onbekend" && s.askedName) return null;
    try {
      s.pendingLook = false; // enkel "ja" + nieuw-object hieronder zet hem weer aan
      s.pendingAskName = false; // enkel "ja" + onbekend hieronder zet hem weer aan
      const driveRows = await loadDrives(awake.id);
      const mood = moodOfRow(awake, now());
      const hasGoal = driveRows.some((drive) => drive.kind === "doel" && isActiveDrive(drive));
      const state = [
        personalityText(awake),
        drivesPromptBlock(driveRows),
        `Huidige stemming: ${mood.emotion} (intensiteit ${mood.intensity.toFixed(2)})`,
        aanleiding && `Aanleiding: ${aanleidingText(aanleiding)}.`,
      ]
        .filter(Boolean)
        .join("\n");
      const { answers } = await experimental_evaluate({
        model: deps.type1,
        state,
        questions: {
          spreken: {
            type: "choice",
            instructions:
              "Wil deze Dynimo nu uit zichzelf, zonder dat iemand iets zei, iets spontaans zeggen? Weeg zijn persoonlijkheid, Drijfveren en stemming; kies 'nee' als er niets de moeite waard is.",
            criteria: { ja: "er is iets dat hij nu wil zeggen", nee: "hij zwijgt liever" },
          },
          onderwerp: {
            type: "choice",
            instructions: "Waar gaat zijn spontane uiting over?",
            criteria: {
              vrij: "iets wat hem bezighoudt of waar hij nieuwsgierig naar is",
              ...(hasGoal && { doel: "een van zijn actieve Doelen" }),
            },
          },
        },
      });
      if (answers.spreken.choice !== "ja") return null;
      // Een aanleiding (Waarneming, of "onbekend" #92) gaat vóór Spontane herinnering en Droom: die worden dan niet gekozen.
      if (aanleiding) {
        s.pendingSpontaneousId = undefined;
        s.pendingDreamId = undefined;
        // Een nieuw object wordt de eerstvolgende initiatiefbeurt een Kijk-beurt (ADR-0019); "terug"/"onbekend" niet.
        s.pendingLook = aanleiding.soort === "nieuw-object";
        if (aanleiding.soort === "onbekend") {
          // #114: niet hier al askedName zetten — pas de echte initiatief-beurt (hear) verbruikt pendingAskName.
          s.pendingAskName = true;
          return `Je begint uit jezelf een gesprek: ${aanleidingText(aanleiding)}. Vraag vriendelijk hoe die heet; noemt die een naam, gebruik dan leerKennen. Wil die zijn naam niet geven, dring dan niet aan.`;
        }
        return `Je begint uit jezelf een gesprek: ${aanleidingText(aanleiding)}. ${
          aanleiding.soort === "terug" ? "Begroet de Gesprekspartner kort, op je eigen manier." : "Reageer daar kort en nieuwsgierig op, op je eigen manier."
        }`;
      }
      const axes = rowAxes(awake);
      // #94: considerInitiative kent geen Gesprekspartner-optie (dus altijd "geen-signaal"); enkel zonder aanwezig
      // (ook weggelaten) valt dit terug op de eigenaar.
      const presentIds = await presentPersonIds({ soort: "geen-signaal" }, options.aanwezig);
      const spontaneous = axes ? await pickSpontaneous(awake.id, axes, SPONTANEOUS_INITIATIVE_CHANCE, presentIds) : null;
      s.pendingSpontaneousId = spontaneous?.id;
      s.pendingDreamId = undefined;
      if (spontaneous) return `Je begint uit jezelf een gesprek en komt spontaan terug op iets uit een eerder gesprek: "${spontaneous.text}". ${SPONTANEOUS_HOW}`;
      // Herinnering gaat voor Droom: nooit beide in één initiatief-moment. Initiatief gebeurt in rust, dus displayState 'wakker'.
      const told = pickDreamToTell({
        dreams: await deps.db.select().from(dreams).where(and(eq(dreams.dynimoId, awake.id), isNull(dreams.toldAt), gt(dreams.createdAt, new Date(now().getTime() - DREAM_MAX_AGE_MS)))),
        values: mood.values,
        displayState: "wakker",
        rng: random,
        now: now(),
      });
      if (told) {
        s.pendingDreamId = told.id;
        return `Je begint uit jezelf een gesprek en vertelt over een droom die je recent had: "${told.text}". ${DREAM_HOW}`;
      }
      return answers.onderwerp.choice === "doel" && hasGoal
        ? "Je begint uit jezelf een gesprek, want je wilt praten over een van je actieve Doelen."
        : "Je begint uit jezelf een gesprek over iets wat je bezighoudt of waar je nieuwsgierig naar bent.";
    } catch (error) {
      console.warn("Initiatief-check faalde:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  return {
    availableModels,
    type2Models,
    setType2Models,
    bringToLife,
    wake,
    sleep,
    kill,
    list,
    backfill,
    reflect,
    runReflection,
    noteReflection,
    considerInitiative,
    hear,
    settled,
    forceMood,
    setMood,
    setAxes,
    setFamiliarity,
    familiarityOf,
    personName,
    voiceProfiles,
    addVoiceProfile,
    recognizeFaces,
    setVerstand,
    setVoiceProfile,
    setArchetype,
    addMemory,
    removeMemory,
    listPersons,
    renamePerson,
    mergePersons,
    deletePerson,
    relearnPerson,
  };
}
