import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "@animus/db";
import * as schema from "@animus/db/schema";

// Enkel het schema importeren (niet createDb/migrate uit @animus/db): zo komt er geen migratiecode in
// de bundel. Eén client per proces; in dev bewaard op globalThis zodat hot-reload er geen lekt.
// Het dashboard schrijft via de brain (server actions), dus deze verbinding is niet read-only.
const globalForDb = globalThis as unknown as { animusDb?: Db };

export const db: Db =
  globalForDb.animusDb ??
  (globalForDb.animusDb = drizzle(
    postgres(process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus", {
      onnotice: () => {},
    }),
    { schema },
  ));
