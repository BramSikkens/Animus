import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, real, serial, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

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
    lastEmotion: text("last_emotion"),
    lastIntensity: real("last_intensity"),
    // NULL = Slapend; gezet = Wakker (en de marker van deze wake-generatie).
    awakeSince: timestamp("awake_since", { withTimezone: true }),
    // Persoonlijkheid: 0..1 = positie richting de tweede letter (I↔E, S↔N, T↔F, J↔P). NULL = nog te backfillen.
    axisIe: real("axis_ie"),
    axisSn: real("axis_sn"),
    axisTf: real("axis_tf"),
    axisJp: real("axis_jp"),
  },
  // Hooguit één Wakker: alle wakkere rijen delen dezelfde constante indexwaarde.
  (table) => [
    check("dynimos_axis_ie_range", sql`${table.axisIe} between 0 and 1`),
    check("dynimos_axis_sn_range", sql`${table.axisSn} between 0 and 1`),
    check("dynimos_axis_tf_range", sql`${table.axisTf} between 0 and 1`),
    check("dynimos_axis_jp_range", sql`${table.axisJp} between 0 and 1`),
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
  },
  (table) => [index("memories_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))],
);

// Drijfveren van een Dynimo (CONTEXT.md). Rijen worden niet hard verwijderd: Doelen gaan naar bereikt/opgegeven
// en sterktes veranderen (#27); "Drijfveren ontbreken" = nul rijen. status enkel voor doelen, strength enkel voor afkeer/ergernis.
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
    strength: real("strength"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("drives_dynimo_id_idx").on(table.dynimoId),
    check("drives_kind_check", sql`${table.kind} in ('wens', 'doel', 'toekomstdroom', 'afkeer', 'ergernis')`),
    check("drives_status_check", sql`${table.status} in ('actief', 'bereikt', 'opgegeven')`),
    check("drives_status_only_goal", sql`(${table.kind} = 'doel') = (${table.status} is not null)`),
    check("drives_strength_only_aversion", sql`(${table.kind} in ('afkeer', 'ergernis')) = (${table.strength} is not null)`),
    check("drives_strength_range", sql`${table.strength} between 0 and 1`),
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
