import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema> & { $client: Sql };

export function createDb(url: string): Db {
  const client = postgres(url, { onnotice: () => {} });
  return drizzle(client, { schema });
}

export async function migrate(db: Db): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
}
