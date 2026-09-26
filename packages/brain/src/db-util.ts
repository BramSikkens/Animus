import type { Db } from "@animus/db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Constraint-naam bij een FK-violation (23503; "" als die naam ontbreekt), anders undefined. Drizzle wikkelt de Postgres-fout in; code/constraint_name zitten op de fout zelf of op `cause` (zie ook page.tsx). */
export function violatedForeignKey(error: unknown): string | undefined {
  const { code, constraint_name: constraint, cause } = error as {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  if ((code ?? cause?.code) !== "23503") return undefined;
  return constraint ?? cause?.constraint_name ?? "";
}
