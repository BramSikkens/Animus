import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { formatAge } from "@animus/brain/age";
import { epitaphs } from "@animus/db/schema";
import { db } from "../../lib/db";
import { formatDate } from "../../lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grafschriften" };

// Grafschriften (ADR-0003): wat er van een gedode Dynimo overblijft, nieuwste eerst.
export default async function GraveyardPage() {
  const rows = await db.select().from(epitaphs).orderBy(desc(epitaphs.deletedAt));
  return (
    <>
      <header className="page-head">
        <h1>Grafschriften</h1>
      </header>
      {rows.length ? (
        <ul className="graves">
          {rows.map((epitaph) => (
            <li key={epitaph.id} className="grave">
              <h2>{epitaph.name}</h2>
              <p className="muted small">
                {formatDate(epitaph.bornAt)} – {formatDate(epitaph.deletedAt)} · {formatAge(epitaph.deletedAt.getTime() - epitaph.bornAt.getTime())}
              </p>
              <p className="prose">{epitaph.farewellReflection}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nog geen Grafschriften: er is nog geen Dynimo gestorven.</p>
      )}
    </>
  );
}
