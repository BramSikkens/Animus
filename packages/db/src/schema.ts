import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

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
    // De waarden spiegelen EMOTIONS uit @animus/brain (db kan de brain niet importeren).
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
    // Archetype (#60): id uit @animus/brain/archetypes; startpunt voor assen/spreekstijl, geen pinning. NULL = geen.
    archetype: text("archetype"),
  },
  // Hooguit één Wakker: alle wakkere rijen delen dezelfde constante indexwaarde.
  (table) => [
    check(
      "dynimos_base_emotion_check",
      sql`${table.baseEmotion} in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal', 'droevig', 'vredig', 'druk')`,
    ),
    check("dynimos_mood_all_or_none", sql`(${table.moodValues} is null) = (${table.moodAt} is null)`),
    check(
      "dynimos_wake_mood_emotion_check",
      sql`${table.wakeMoodEmotion} in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal', 'droevig', 'vredig', 'druk')`,
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
    uniqueIndex("dynimos_single_awake_idx").on(sql`(true)`).where(sql`${table.awakeSince} is not null`),
  ],
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
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    // Hoe vormend de uiting was (Type1, 0..1); zware Indruk weegt zwaar in de Reflectie. Default = neutraal.
    impression: real("impression").notNull().default(0.5),
    // Laatst spontaan aangehaald (Spontane herinnering, cooldown); null = nog nooit.
    lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true }),
  },
  (table) => [
    index("memories_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    check("memories_impression_range", sql`${table.impression} between 0 and 1`),
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
      sql`${table.emotion} in ('blij', 'boos', 'verrast', 'kalm', 'verveeld', 'nieuwsgierig', 'bang', 'neutraal', 'droevig', 'vredig', 'druk')`,
    ),
    check("dreams_intensity_range", sql`${table.intensity} between 0 and 1`),
  ],
);

// Grafschrift van een verwijderd wezen (ADR-0003). Bewust géén relatie met identity/memories,
// en het brein leest deze tabel nooit — enkel het dashboard. Leeftijd = deleted_at − born_at (ADR-0002).
export const epitaphs = pgTable("epitaphs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bornAt: timestamp("born_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  farewellReflection: text("farewell_reflection").notNull(),
});
