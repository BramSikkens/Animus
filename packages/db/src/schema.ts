import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, real, serial, text, timestamp, vector } from "drizzle-orm/pg-core";

// Exact één rij mogelijk: id is vastgepind op 1 en gecheckt in de DB.
export const identity = pgTable(
  "identity",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name").notNull(),
    coreCharacter: text("core_character").notNull(),
    evolvedCharacter: text("evolved_character").notNull().default(""),
    birthStory: text("birth_story").notNull(),
    seed: text("seed").notNull(),
    bornAt: timestamp("born_at", { withTimezone: true }).notNull(),
    lastEmotion: text("last_emotion"),
    lastIntensity: real("last_intensity"),
  },
  (table) => [check("identity_singleton", sql`${table.id} = 1`)],
);

// Dimensie van OpenAI text-embedding-3-small (ADR-0008): een andere embedding-provider
// betekent een migratie én alles opnieuw embedden.
export const EMBEDDING_DIMENSIONS = 1536;

// Eén herinnering per afgeronde beurt.
export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("memories_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))],
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
