import { createDb, type Db } from "@animus/db";

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
  await db.execute(`TRUNCATE TABLE dynimos, memories, epitaphs RESTART IDENTITY CASCADE`);
}
