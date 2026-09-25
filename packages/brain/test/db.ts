import { eq } from "drizzle-orm";
import { createDb, type Db } from "@animus/db";
import { persons } from "@animus/db/schema";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus";
export const TEST_DB_NAME = "animus_test";

export function databaseUrl(database: string): string {
  const parsed = new URL(ADMIN_URL);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function createTestDb(): Db {
  return createDb(databaseUrl(TEST_DB_NAME));
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(`TRUNCATE TABLE dynimos, memories, drives, epitaphs, persons, familiarities, voice_profiles, face_embeddings RESTART IDENTITY CASCADE`);
}

/** Bestaande eigenaar-rij, of maakt er één aan (gedeeld tussen testbestanden die "zonder aanwezig-signalen" opzetten, #94). */
export async function ensureOwner(db: Db): Promise<number> {
  const [existing] = await db.select({ id: persons.id }).from(persons).where(eq(persons.owner, true));
  if (existing) return existing.id;
  const [row] = await db.insert(persons).values({ name: "eigenaar", owner: true }).returning({ id: persons.id });
  return row!.id;
}
