import { desc, eq, isNull } from "drizzle-orm";
import { formatAge } from "@animus/brain/age";
import { moodOfRow } from "@animus/brain/mood";
import { DRIVE_KINDS, DRIVE_LABELS, type DriveKind } from "@animus/brain/drives";
import { AXES, AXIS_LETTERS, mbtiType, rowAxes } from "@animus/brain/personality";
import { dreams, drives, dynimos, epitaphs, memories } from "@animus/db/schema";
import { db } from "../lib/db";
import { ActionForm } from "./action-form";
import { bringToLife, kill, sleep, wake } from "./actions";
import { formatDate, formatDateTime } from "../lib/format";

export const dynamic = "force-dynamic";

const RECENT_MEMORIES_LIMIT = 20;
const RECENT_DREAMS_LIMIT = 5;

// Postgres "undefined_table": de database is nog niet gemigreerd.
const UNDEFINED_TABLE = "42P01";

async function loadDashboard() {
  const [dynimoRows, epitaphRows, driveRows] = await Promise.all([
    db.select().from(dynimos).orderBy(dynimos.id),
    db.select().from(epitaphs).orderBy(desc(epitaphs.deletedAt)),
    db.select().from(drives).where(isNull(drives.droppedAt)).orderBy(drives.id),
  ]);
  // Eén query voor alle Drijfveren; groeperen per Dynimo in code (geen N+1).
  const drivesByDynimo = new Map<number, typeof driveRows>();
  for (const drive of driveRows) drivesByDynimo.set(drive.dynimoId, [...(drivesByDynimo.get(drive.dynimoId) ?? []), drive]);
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
  const recentDreams = await Promise.all(
    dynimoRows.map((dynimo) =>
      db
        .select()
        .from(dreams)
        .where(eq(dreams.dynimoId, dynimo.id))
        .orderBy(desc(dreams.createdAt), desc(dreams.id))
        .limit(RECENT_DREAMS_LIMIT),
    ),
  );
  return { dynimoRows, recentMemories, recentDreams, epitaphRows, drivesByDynimo };
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
  const { dynimoRows, recentMemories, recentDreams, epitaphRows, drivesByDynimo } = data;

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
              const axes = rowAxes(dynimo);
              // Enkel de wakkere Dynimo heeft een levende Stemming.
              const mood = awake ? moodOfRow(dynimo, new Date()) : null;
              return (
                <li key={dynimo.id}>
                  <h3>{dynimo.name}</h3>
                  <p>
                    {awake ? "wakker" : "slapend"} · Leeftijd: {formatAge(Date.now() - dynimo.bornAt.getTime())}
                  </p>
                  {mood && (
                    <p>
                      Stemming: {mood.emotion}
                      <span className="bar" role="img" aria-label={`intensiteit ${Math.round(mood.intensity * 100)}%`}>
                        <span className="bar-fill" style={{ width: `${Math.round(mood.intensity * 100)}%` }} />
                      </span>
                      {Math.round(mood.intensity * 100)}%
                    </p>
                  )}
                  <p>Basisemotie: {dynimo.baseEmotion ?? "nog niet bepaald"}</p>
                  {axes ? (
                    <div className="personality">
                      <p>
                        Persoonlijkheid: <strong>{mbtiType(axes)}</strong>
                      </p>
                      {AXES.map((axis) => {
                        const percent = Math.round(axes[axis] * 100);
                        const [first, second] = AXIS_LETTERS[axis];
                        return (
                          <p key={axis} className="axis">
                            {first}
                            <span className="bar" role="img" aria-label={`${first}↔${second}: ${percent}% richting ${second}`}>
                              <span className="bar-fill" style={{ width: `${percent}%` }} />
                            </span>
                            {second}
                          </p>
                        );
                      })}
                    </div>
                  ) : (
                    <p>Persoonlijkheid: nog niet bepaald</p>
                  )}
                  <div className="drives">
                    <p>Drijfveren:</p>
                    {DRIVE_KINDS.map((kind: DriveKind) => {
                      const ofKind = (drivesByDynimo.get(dynimo.id) ?? []).filter((drive) => drive.kind === kind);
                      return (
                        <div key={kind}>
                          <h4>{DRIVE_LABELS[kind]}</h4>
                          {ofKind.length ? (
                            <ul>
                              {ofKind.map((drive) => (
                                <li key={drive.id}>
                                  {drive.text}
                                  {drive.status && <em> — {drive.status}</em>}
                                  {drive.strength !== null && (
                                    <>
                                      <span
                                        className="bar"
                                        role="img"
                                        aria-label={`sterkte ${Math.round(drive.strength * 100)}%`}
                                      >
                                        <span className="bar-fill" style={{ width: `${Math.round(drive.strength * 100)}%` }} />
                                      </span>
                                      {Math.round(drive.strength * 100)}%
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>nog geen</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {awake ? (
                    <ActionForm action={sleep} label="Laten slapen" pendingLabel="Reflecteert…" />
                  ) : (
                    <ActionForm action={wake} label="Wakker maken" pendingLabel="Wordt wakker…" id={dynimo.id} />
                  )}
                  <ActionForm action={kill} label="Doden" pendingLabel="Neemt afscheid…" id={dynimo.id} confirmName />
                  <details>
                    <summary>Details en herinneringen</summary>
                    <dl>
                      <dt>Kern-karakter</dt>
                      <dd>{dynimo.coreCharacter}</dd>
                      {dynimo.evolvedCharacter && (
                        <>
                          <dt>Geëvolueerd karakter</dt>
                          <dd style={{ whiteSpace: "pre-wrap" }}>{dynimo.evolvedCharacter}</dd>
                        </>
                      )}
                      <dt>Geboorteverhaal</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{dynimo.birthStory}</dd>
                      <dt>Seed</dt>
                      <dd>{dynimo.seed}</dd>
                      <dt>Geboortedatum</dt>
                      <dd>{formatDate(dynimo.bornAt)}</dd>
                    </dl>
                    <h4>Recente dromen</h4>
                    {recentDreams[index]!.length ? (
                      <ul>
                        {recentDreams[index]!.map((dream) => (
                          <li key={dream.id}>
                            <time dateTime={dream.createdAt.toISOString()}>{formatDateTime(dream.createdAt)}</time>
                            <em> — {dream.emotion} ({Math.round(dream.intensity * 100)}%)</em>
                            <p style={{ whiteSpace: "pre-wrap" }}>{dream.text}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>nog geen</p>
                    )}
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
