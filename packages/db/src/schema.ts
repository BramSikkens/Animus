import { sql } from "drizzle-orm";
import { boolean, check, customType, date, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

// Ruwe bytes (sherpa-onnx-embedding als Float32Array-bytes, nooit audio zelf); drizzle-orm heeft geen ingebouwd bytea-type. Geen Buffer-type
// hier (dit package heeft geen @types/node): de postgres-driver accepteert/levert Uint8Array-compatibele waarden.
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

// Meerdere rijen mogelijk: elke rij is een Dynimo.
export const dynimos = pgTable(
  "dynimos",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    coreCharacter: text("core_character").notNull(),
    evolvedCharacter: text("evolved_character").notNull().default(""),
    birthStory: text("birth_story").notNull(),
    seed: text("seed").notNull(),
    bornAt: timestamp("born_at", { withTimezone: true }).notNull(),
    // Basisemotie: het temperament waar de Stemming naartoe uitdooft. NULL = nog te backfillen.
    // De waarden spiegelen EMOTIONS uit @animus/core (db kan de Animus niet importeren).
    baseEmotion: text("base_emotion"),
    // Stemming: vector {emotie: 0–100} voor alle emoties, plus het tijdstip; de waarden doven uit (zie mood.ts).
    // Beide samen NULL of gezet.
    moodValues: jsonb("mood_values"),
    moodAt: timestamp("mood_at", { withTimezone: true }),
    // Reflectie (#27): tot en met welke Herinnering er gereflecteerd is (NULL = nog nooit), en de Ontwaakstemming
    // waarmee de Dynimo bij het wekken begint (samen NULL of samen gezet).
    lastReflectedAt: timestamp("last_reflected_at", { withTimezone: true }),
    wakeMoodEmotion: text("wake_mood_emotion"),
    wakeMoodIntensity: real("wake_mood_intensity"),
    // Verjaardag (#39): de kalenderdag waarop de verjaardagsboost al gegeven is (idempotent over herstarts).
    lastBirthdayBoostOn: date("last_birthday_boost_on", { mode: "string" }),
    // NULL = Slapend; gezet = Wakker (en de marker van deze wake-generatie).
    awakeSince: timestamp("awake_since", { withTimezone: true }),
    // Persoonlijkheid: 0..1 = positie richting de tweede letter (I↔E, S↔N, T↔F, J↔P). NULL = nog te backfillen.
    axisIe: real("axis_ie"),
    axisSn: real("axis_sn"),
    axisTf: real("axis_tf"),
    axisJp: real("axis_jp"),
    // Reactiviteit (#59): hoe hard emoties bewegen en hoe traag ze uitdoven. Expressiviteit: hoeveel emotie doorschemert.
    axisReactivity: real("axis_reactivity").notNull().default(0.5),
    axisExpressiveness: real("axis_expressiveness").notNull().default(0.5),
    // TTS-stem (model/stemnaam van de actieve spraakprovider). NULL = default van de agent.
    voice: text("voice"),
    // Vrije stembeschrijving (#62), input voor Voice Design (#64). NULL = geen.
    voiceDescription: text("voice_description"),
    // Archetype (#60): id uit @animus/core/archetypes; startpunt voor assen/spreekstijl, geen pinning. NULL = geen.
    archetype: text("archetype"),
    // Verstand (#96/#97): 0–1, hoe inhoudelijk hij antwoordt (los van hoe hij praat, zie verstand.ts). NULL = nog te
    // backfillen; telt tot dan als 0.5 (middenband, gedrag zoals nu).
    verstand: real("verstand"),
  },
  // Hooguit één Wakker: alle wakkere rijen delen dezelfde constante indexwaarde.
  (table) => [
    check(
      "dynimos_base_emotion_check",
      sql`${table.baseEmotion} in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'droevig', 'vredig', 'druk')`,
    ),
    check("dynimos_mood_all_or_none", sql`(${table.moodValues} is null) = (${table.moodAt} is null)`),
    check(
      "dynimos_wake_mood_emotion_check",
      sql`${table.wakeMoodEmotion} in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'droevig', 'vredig', 'druk')`,
    ),
    check("dynimos_wake_mood_intensity_range", sql`${table.wakeMoodIntensity} between 0 and 1`),
    check(
      "dynimos_wake_mood_all_or_none",
      sql`(${table.wakeMoodEmotion} is null) = (${table.wakeMoodIntensity} is null)`,
    ),
    check("dynimos_axis_ie_range", sql`${table.axisIe} between 0 and 1`),
    check("dynimos_axis_sn_range", sql`${table.axisSn} between 0 and 1`),
    check("dynimos_axis_tf_range", sql`${table.axisTf} between 0 and 1`),
    check("dynimos_axis_jp_range", sql`${table.axisJp} between 0 and 1`),
    check("dynimos_axis_reactivity_range", sql`${table.axisReactivity} between 0 and 1`),
    check("dynimos_axis_expressiveness_range", sql`${table.axisExpressiveness} between 0 and 1`),
    check("dynimos_verstand_range", sql`${table.verstand} between 0 and 1`),
    uniqueIndex("dynimos_single_awake_idx").on(sql`(true)`).where(sql`${table.awakeSince} is not null`),
  ],
);

// Persoon (fase 3, #91): globaal, herkend door alle Dynimo's; de relatie (Vertrouwdheid, Herinneringen) is per
// Dynimo × Persoon. Eén Persoon is de "eigenaar" (owner); hooguit één rij mag dat zijn.
export const persons = pgTable(
  "persons",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    owner: boolean("owner").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("persons_single_owner_idx").on(sql`(true)`).where(sql`${table.owner}`)],
);

// Stemprofielen (#92): sherpa-onnx-embedding per Persoon, hoogstens 5 (oudste wordt vervangen, zie addVoiceProfile).
// Nooit audio zelf, enkel het geëxporteerde profiel (art. 9 AVG, ADR-0020).
export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    profile: bytea("profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("voice_profiles_person_id_idx").on(table.personId)],
);

// Gezichts-embeddings (#93): Human's face.embedding (faceres-model), hoogstens 5 per Persoon (zie recognizeFaces).
// Nooit beelden zelf (art. 9 AVG, ADR-0020).
export const FACE_EMBEDDING_DIMENSIONS = 1024;

export const faceEmbeddings = pgTable(
  "face_embeddings",
  {
    id: serial("id").primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: FACE_EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("face_embeddings_embedding_idx").using("hnsw", table.embedding.op("vector_l2_ops")), index("face_embeddings_person_id_idx").on(table.personId)],
);

// Dimensie van OpenAI text-embedding-3-small (ADR-0008): een andere embedding-provider
// betekent een migratie én alles opnieuw embedden.
export const EMBEDDING_DIMENSIONS = 1536;

// Eén herinnering per afgeronde beurt.
export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    dynimoId: integer("dynimo_id")
      .notNull()
      .references(() => dynimos.id, { onDelete: "cascade" }),
    // Persoon (fase 3, #91): de Gesprekspartner van deze beurt; null bij een onbekende.
    personId: integer("person_id").references(() => persons.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    // Hoe vormend de uiting was (Type1, 0..1); zware Indruk weegt zwaar in de Reflectie. Default = neutraal.
    impression: real("impression").notNull().default(0.5),
    // Laatst spontaan aangehaald (Spontane herinnering, cooldown); null = nog nooit.
    lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true }),
    // Modelwissel-experiment (#123): welk Type2-model deze Herinnering schreef (hear()/onthoud-tool). Null bij
    // een dashboard-Herinnering (addMemory) — die gaat buiten Type2 om.
    model: text("model"),
  },
  (table) => [
    index("memories_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    // #110: (dynimo_id, created_at) dekt Reflectie/Spontane-herinnering (filter op dynimo_id, sorteren/grenzen op
    // created_at); person_id apart voor de aanwezig-/Spontane-queries die op Persoon filteren.
    index("memories_dynimo_id_created_at_idx").on(table.dynimoId, table.createdAt),
    index("memories_person_id_idx").on(table.personId),
    check("memories_impression_range", sql`${table.impression} between 0 and 1`),
  ],
);

// Vertrouwdheid (#75/#91) per Dynimo × Persoon: 0–1, hoe vertrouwd de relatie is; stuurt de toon (familiarity.ts).
export const familiarities = pgTable(
  "familiarities",
  {
    dynimoId: integer("dynimo_id")
      .notNull()
      .references(() => dynimos.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    familiarity: real("familiarity").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dynimoId, table.personId] }),
    // #110: de samengestelde PK dekt person_id niet als eerste kolom; een lookup op person_id alleen heeft dus een eigen index nodig.
    index("familiarities_person_id_idx").on(table.personId),
    check("familiarities_familiarity_range", sql`${table.familiarity} between 0 and 1`),
  ],
);

// Drijfveren van een Dynimo (CONTEXT.md). Rijen worden niet hard verwijderd: Doelen gaan naar bereikt/opgegeven
// (#27); "Drijfveren ontbreken" = nul rijen. status enkel voor doelen.
export const drives = pgTable(
  "drives",
  {
    id: serial("id").primaryKey(),
    dynimoId: integer("dynimo_id")
      .notNull()
      .references(() => dynimos.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    // Zachte verwijdering: Drijfveren worden nooit hard verwijderd ("nul rijen" = ontbreekt voor de backfill).
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
  },
  (table) => [
    index("drives_dynimo_id_idx").on(table.dynimoId),
    check("drives_kind_check", sql`${table.kind} in ('wens', 'doel', 'toekomstdroom', 'ergernis')`),
    check("drives_status_check", sql`${table.status} in ('actief', 'bereikt', 'opgegeven')`),
    check("drives_status_only_goal", sql`(${table.kind} = 'doel') = (${table.status} is not null)`),
  ],
);

// Dromen (#38): korte, associatieve tekst uit de Reflectie-bij-het-slapen. Emotie + intensiteit zijn de gevoelslading
// van de Droom; die overschrijft de Ontwaakstemming enkel als hij intenser is. Cascade bij het doden van de Dynimo.
export const dreams = pgTable(
  "dreams",
  {
    id: serial("id").primaryKey(),
    dynimoId: integer("dynimo_id")
      .notNull()
      .references(() => dynimos.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    emotion: text("emotion").notNull(),
    intensity: real("intensity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    toldAt: timestamp("told_at", { withTimezone: true }),
  },
  (table) => [
    index("dreams_dynimo_id_idx").on(table.dynimoId),
    check(
      "dreams_emotion_check",
      sql`${table.emotion} in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'droevig', 'vredig', 'druk')`,
    ),
    check("dreams_intensity_range", sql`${table.intensity} between 0 and 1`),
  ],
);

// Grafschrift van een verwijderd wezen (ADR-0003). Bewust géén relatie met identity/memories,
// en de Animus leest deze tabel nooit — enkel het dashboard. Leeftijd = deleted_at − born_at (ADR-0002).
export const epitaphs = pgTable("epitaphs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bornAt: timestamp("born_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  farewellReflection: text("farewell_reflection").notNull(),
});

// Modelwissel-experiment (#123): singleton-rij (id vast op 1) met het globaal ingestelde Type2-model; null per
// veld = env-standaard (TYPE2_LIGHT_MODEL/TYPE2_HEAVY_MODEL). Geen historiek, één actieve keuze per omgeving.
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    type2Light: text("type2_light"),
    type2Heavy: text("type2_heavy"),
  },
  (table) => [check("settings_single_row", sql`${table.id} = 1`)],
);
