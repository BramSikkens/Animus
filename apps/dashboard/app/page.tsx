import { desc } from "drizzle-orm";
import { formatAge } from "@animus/brain/age";
import { epitaphs, identity, memories } from "@animus/db/schema";
import { db } from "../lib/db";
import { formatDate, formatDateTime } from "../lib/format";

export const dynamic = "force-dynamic";

const RECENT_MEMORIES_LIMIT = 20;

// Postgres "undefined_table": de database is nog niet gemigreerd.
const UNDEFINED_TABLE = "42P01";

async function loadDashboard() {
  const [beingRows, recentMemories, epitaphRows] = await Promise.all([
    db.select().from(identity).limit(1),
    db
      .select({ id: memories.id, text: memories.text, createdAt: memories.createdAt })
      .from(memories)
      .orderBy(desc(memories.createdAt))
      .limit(RECENT_MEMORIES_LIMIT),
    db.select().from(epitaphs).orderBy(desc(epitaphs.deletedAt)),
  ]);
  return { being: beingRows[0] ?? null, recentMemories, epitaphRows };
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
  const { being, recentMemories, epitaphRows } = data;
  const intensityPercent = being?.lastIntensity != null ? Math.round(being.lastIntensity * 100) : null;

  return (
    <main>
      <h1>Animus — dashboard</h1>

      {being ? (
        <>
          <section>
            <h2>Identiteit</h2>
            <dl>
              <dt>Naam</dt>
              <dd>{being.name}</dd>
              <dt>Kern-karakter</dt>
              <dd>{being.coreCharacter}</dd>
              <dt>Geboorteverhaal</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{being.birthStory}</dd>
              <dt>Seed</dt>
              <dd>{being.seed}</dd>
              <dt>Geboortedatum</dt>
              <dd>{formatDate(being.bornAt)}</dd>
              <dt>Leeftijd</dt>
              <dd>{formatAge(Date.now() - being.bornAt.getTime())}</dd>
            </dl>
          </section>

          <section>
            <h2>Emotie</h2>
            {being.lastEmotion && intensityPercent != null ? (
              <p>
                {being.lastEmotion}
                <span className="bar" aria-hidden="true">
                  <span className="bar-fill" style={{ width: `${intensityPercent}%` }} />
                </span>
                {intensityPercent}%
              </p>
            ) : (
              <p>nog geen</p>
            )}
          </section>

          <section>
            <h2>Recente herinneringen</h2>
            {recentMemories.length ? (
              <ul>
                {recentMemories.map((memory) => (
                  <li key={memory.id}>
                    <time dateTime={memory.createdAt.toISOString()}>{formatDateTime(memory.createdAt)}</time>
                    <p style={{ whiteSpace: "pre-wrap" }}>{memory.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>nog geen</p>
            )}
          </section>
        </>
      ) : (
        <p>
          Er is nog geen wezen. Start <code>pnpm repl</code> om er een te laten geboren worden.
        </p>
      )}

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
