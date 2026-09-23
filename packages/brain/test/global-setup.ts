import postgres from "postgres";
import { migrate } from "@animus/db";
import { createTestDb, databaseUrl, TEST_DB_NAME } from "./db.js";

export default async function globalSetup(): Promise<void> {
  const admin = postgres(databaseUrl("postgres"), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const db = createTestDb();
  try {
    await migrate(db);
  } finally {
    await db.$client.end();
  }
}
