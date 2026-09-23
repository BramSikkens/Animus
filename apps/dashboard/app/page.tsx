import { desc, eq } from "drizzle-orm";
import { formatAge } from "@animus/brain/age";
import { dynimos, epitaphs, memories } from "@animus/db/schema";
import { db } from "../lib/db";
import { ActionForm } from "./action-form";
import { bringToLife, kill, sleep, wake } from "./actions";
import { formatDate, formatDateTime } from "../lib/format";

export const dynamic = "force-dynamic";

const RECENT_MEMORIES_LIMIT = 20;

// Postgres "undefined_table": de database is nog niet gemigreerd.
const UNDEFINED_TABLE = "42P01";

async function loadDashboard() {
  const [dynimoRows, epitaphRows] = await Promise.all([
    db.select().from(dynimos).orderBy(dynimos.id),
    db.select().from(epitaphs).orderBy(desc(epitaphs.deletedAt)),
  ]);
  const recentMemories = await Promise.all(
    dynimoRows.map((dynimo) =>
      db
        .select({ id: memories.id, text: memories.text, createdAt: memories.createdAt })
        .from(memories)
        .where(eq(memories.dynimoId, dynimo.id))
        .orderBy(desc(memories.createdAt))
        .limit(RECENT_MEMORIES_LIMIT),
    ),
  );
  return { dynimoRows, recentMemories, epitaphRows };
}

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof loadDashboard>>;
  try {
    data = await loadDashboard();
  } catch (error) {
    // Drizzle wikkelt de Postgres-fout in; de code zit op de fout zelf of op `cause`.
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    if ((code ?? cause?.code) !== UNDEFINED_TABLE) throw error;
    return (
      <main>
        <h1>Animus — dashboard</h1>
        <p>
          De database is nog niet gemigreerd. Draai <code>pnpm db:migrate</code> (of start <code>pnpm repl</code>).
        </p>
      </main>
    );
  }
  const { dynimoRows, recentMemories, epitaphRows } = data;

  return (
    <main>
      <h1>Animus — dashboard</h1>

      <section>
        <h2>Dynimo&apos;s</h2>
        <ActionForm action={bringToLife} label="Tot leven wekken" pendingLabel="Wordt geboren…" />
        {dynimoRows.length ? (
          <ul>
            {dynimoRows.map((dynimo, index) => {
              const awake = dynimo.awakeSince !== null;
              const intensityPercent = dynimo.lastIntensity != null ? Math.round(dynimo.lastIntensity * 100) : null;
              return (
                <li key={dynimo.id}>
                  <h3>{dynimo.name}</h3>
                  <p>
                    {awake ? "wakker" : "slapend"} · Leeftijd: {formatAge(Date.now() - dynimo.bornAt.getTime())}
                  </p>
                  {awake ? (
                    <ActionForm action={sleep} label="Laten slapen" pendingLabel="Bezig…" />
                  ) : (
                    <ActionForm action={wake} label="Wakker maken" pendingLabel="Bezig…" id={dynimo.id} />
                  )}
                  <ActionForm action={kill} label="Doden" pendingLabel="Neemt afscheid…" id={dynimo.id} confirmName />
                  <details>
                    <summary>Details en herinneringen</summary>
                    <dl>
                      <dt>Kern-karakter</dt>
                      <dd>{dynimo.coreCharacter}</dd>
                      <dt>Geboorteverhaal</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{dynimo.birthStory}</dd>
                      <dt>Seed</dt>
                      <dd>{dynimo.seed}</dd>
                      <dt>Geboortedatum</dt>
                      <dd>{formatDate(dynimo.bornAt)}</dd>
                      <dt>Laatste emotie</dt>
                      <dd>
                        {dynimo.lastEmotion && intensityPercent != null ? (
                          <>
                            {dynimo.lastEmotion}
                            <span className="bar" aria-hidden="true">
                              <span className="bar-fill" style={{ width: `${intensityPercent}%` }} />
                            </span>
                            {intensityPercent}%
                          </>
                        ) : (
                          "nog geen"
                        )}
                      </dd>
                    </dl>
                    <h4>Recente herinneringen</h4>
                    {recentMemories[index]!.length ? (
                      <ul>
                        {recentMemories[index]!.map((memory) => (
                          <li key={memory.id}>
                            <time dateTime={memory.createdAt.toISOString()}>{formatDateTime(memory.createdAt)}</time>
                            <p style={{ whiteSpace: "pre-wrap" }}>{memory.text}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>nog geen</p>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Er zijn nog geen Dynimo&apos;s — wek er een tot leven.</p>
        )}
      </section>

      <section>
        <h2>Grafschriften</h2>
        {epitaphRows.length ? (
          <ul>
            {epitaphRows.map((epitaph) => (
              <li key={epitaph.id}>
                <h3>{epitaph.name}</h3>
                <dl>
                  <dt>Leeftijd bij verwijdering</dt>
                  <dd>{formatAge(epitaph.deletedAt.getTime() - epitaph.bornAt.getTime())}</dd>
                  <dt>Laatste woorden</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{epitaph.farewellReflection}</dd>
                  <dt>Verwijderd op</dt>
                  <dd>{formatDate(epitaph.deletedAt)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <p>nog geen</p>
        )}
      </section>
    </main>
  );
}
