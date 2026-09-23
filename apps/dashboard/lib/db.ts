import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@animus/db/schema";

// Enkel het schema importeren (niet createDb/migrate uit @animus/db): zo komt er geen migratiecode in
// de bundel. Eén client per proces, en read-only afgedwongen door Postgres zelf.
export const db = drizzle(
  postgres(process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus", {
    connection: { default_transaction_read_only: true },
    onnotice: () => {},
  }),
  { schema },
);
