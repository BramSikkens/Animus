import Link from "next/link";
import { formatAge } from "@animus/brain/age";
import { getArchetype } from "@animus/brain/archetypes";
import { displayMoodOfRow, moodOfRow } from "@animus/brain/mood";
import { mbtiType, rowAxes } from "@animus/brain/personality";
import { dynimos } from "@animus/db/schema";
import { db } from "../lib/db";
import { ActionForm } from "./action-form";
import { bringToLife, sleep, wake } from "./actions";
import { MoodStrip } from "./mood-strip";

export const dynamic = "force-dynamic";

// Postgres "undefined_table": de database is nog niet gemigreerd.
const UNDEFINED_TABLE = "42P01";

async function loadDynimos() {
  try {
    return await db.select().from(dynimos).orderBy(dynimos.id);
  } catch (error) {
    // Drizzle wikkelt de Postgres-fout in; de code zit op de fout zelf of op `cause`.
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    if ((code ?? cause?.code) !== UNDEFINED_TABLE) throw error;
    return null;
  }
}

// Overzicht (#128): elke Dynimo als levensband; de wakkere bovenaan, de slapende gedempt eronder.
export default async function OverviewPage() {
  const rows = await loadDynimos();
  if (!rows) {
    return (
      <div className="empty">
        <h1>De databank is nog niet gemigreerd</h1>
        <p className="muted">
          Draai <code>pnpm db:migrate</code> (of start <code>pnpm dev</code>) en laad deze pagina opnieuw.
        </p>
      </div>
    );
  }
  const now = new Date();
  const ordered = [...rows].sort((a, b) => Number(b.awakeSince !== null) - Number(a.awakeSince !== null));

  return (
    <>
      <header className="page-head">
        <h1>Dynimo&apos;s</h1>
        <ActionForm action={bringToLife} label="Nieuw leven wekken" pendingLabel="Wordt geboren…" />
      </header>

      {ordered.length ? (
        <ul className="bands">
          {ordered.map((dynimo) => {
            const awake = dynimo.awakeSince !== null;
            const axes = rowAxes(dynimo);
            const archetype = getArchetype(dynimo.archetype)?.name;
            // Enkel de wakkere Dynimo heeft een levende Stemming; bij een slapende de ruststand waar ze naartoe dooft.
            const values = moodOfRow(dynimo, now).values;
            const dominant = awake ? displayMoodOfRow(dynimo, now).emotion : undefined;
            return (
              <li key={dynimo.id} className={awake ? "band band-awake" : "band band-asleep"}>
                <div className="band-id">
                  <p className="band-name">
                    <span className={awake ? "awake-dot" : "asleep-dot"} aria-hidden="true" />
                    <Link href={`/dynimo/${dynimo.id}`}>{dynimo.name}</Link>
                  </p>
                  <p className="band-meta">
                    {awake ? "wakker" : "slaapt"} · {formatAge(now.getTime() - dynimo.bornAt.getTime())}
                    {archetype && ` · ${archetype}`}
                    {axes && ` · ${mbtiType(axes)}`}
                  </p>
                </div>
                <MoodStrip values={values} dominant={dominant} />
                <div className="band-actions">
                  {awake ? (
                    <ActionForm action={sleep} label="Laten slapen" pendingLabel="Valt in slaap…" />
                  ) : (
                    <ActionForm action={wake} label="Wakker maken" pendingLabel="Wordt wakker…" id={dynimo.id} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">
          <h2>Nog geen Dynimo&apos;s</h2>
          <p className="muted">Een nieuwe Dynimo kiest bij zijn geboorte zelf een karakter en een naam.</p>
          <ActionForm action={bringToLife} label="Nieuw leven wekken" pendingLabel="Wordt geboren…" />
        </div>
      )}
    </>
  );
}
