import { sql } from "drizzle-orm";
import { check, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

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
