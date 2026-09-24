import { desc, eq, isNull } from "drizzle-orm";
import { EMOTIONS, EMOTION_GROUPS } from "@animus/brain/emotion";
import { formatAge } from "@animus/brain/age";
import { moodOfRow } from "@animus/brain/mood";
import { DRIVE_KINDS, DRIVE_LABELS, type DriveKind } from "@animus/brain/drives";
import { ARCHETYPES, getArchetype } from "@animus/brain/archetypes";
import { AXES, AXIS_LABELS, AXIS_LETTERS, MBTI_AXES, mbtiType, rowAxes } from "@animus/brain/personality";
import { speechProvider, voicesFor } from "@animus/brain/voice";
import { dreams, drives, dynimos, epitaphs, memories } from "@animus/db/schema";
import { db } from "../lib/db";
import { ActionForm } from "./action-form";
import { VoiceCatalog } from "./voice-catalog";
import { VoiceDesign } from "./voice-design";
import { getCatalog, getTier } from "../lib/voice-catalog";
import { addMemory, bringToLife, forceMood, kill, removeMemory, setArchetype, setAxes, setMood, setVoice, sleep, wake } from "./actions";
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
  const provider = speechProvider(process.env);
  const voices = voicesFor(provider);
  // Catalogus alleen bij ElevenLabs; bij een API-fout melden en de vaste lijst tonen.
  const catalog =
    provider === "elevenlabs"
      ? await getCatalog().then(
          (list) => ({ list }),
          (error: unknown) => ({ error: error instanceof Error ? error.message : "onbekende fout" }),
        )
      : null;
  const freeTier = provider === "elevenlabs" && (await getTier()) === "free";

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
                  <p>Archetype: {getArchetype(dynimo.archetype)?.name ?? "geen"}</p>
                  <p>Basisemotie: {dynimo.baseEmotion ?? "nog niet bepaald"}</p>
                  {axes ? (
                    <div className="personality">
                      <p>
                        Persoonlijkheid: <strong>{mbtiType(axes)}</strong>
                      </p>
                      {MBTI_AXES.map((axis) => {
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
                  <ActionForm action={forceMood} label="Stemming forceren" pendingLabel="Zet…" id={dynimo.id}>
                    <select name="emotion" aria-label="Emotie" defaultValue="blij">
                      {EMOTIONS.map((emotion) => (
                        <option key={emotion} value={emotion}>
                          {emotion}
                        </option>
                      ))}
                    </select>
                    <input name="intensity" type="number" min={0} max={1} step={0.05} defaultValue={0.8} aria-label="Intensiteit (0 tot 1)" required />
                  </ActionForm>
                  <ActionForm action={setMood} label="Stemming zetten" pendingLabel="Zet…" id={dynimo.id}>
                    {EMOTION_GROUPS.map((group) => (
                      <div key={group[0]} className="slider-group">
                        {group.map((emotion) => (
                          <label key={emotion} className="slider">
                            {emotion}
                            <input name={`mood_${emotion}`} type="range" min={0} max={100} step={1} defaultValue={Math.round(moodOfRow(dynimo, new Date()).values[emotion])} />
                          </label>
                        ))}
                      </div>
                    ))}
                  </ActionForm>
                  <ActionForm action={setAxes} label="Persoonlijkheid zetten" pendingLabel="Zet…" id={dynimo.id}>
                    {AXES.map((axis) => (
                      <label key={axis} className="slider">
                        {AXIS_LABELS[axis]}
                        <input name={`axis_${axis}`} type="range" min={0} max={1} step={0.01} defaultValue={axes?.[axis] ?? 0.5} />
                      </label>
                    ))}
                  </ActionForm>
                  <ActionForm action={setArchetype} label="Archetype toepassen (zet assen en basisemotie)" pendingLabel="Zet…" id={dynimo.id}>
                    <select name="archetype" aria-label="Archetype" defaultValue={getArchetype(dynimo.archetype)?.id ?? ARCHETYPES[0]!.id}>
                      {ARCHETYPES.map((archetype) => (
                        <option key={archetype.id} value={archetype.id}>
                          {archetype.name}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                  {catalog && "list" in catalog ? (
                    <VoiceCatalog
                      id={dynimo.id}
                      voices={catalog.list}
                      current={dynimo.voice}
                      description={dynimo.voiceDescription ?? ""}
                      hint={getArchetype(dynimo.archetype)?.voiceHint ?? ""}
                    />
                  ) : (
                    <>
                      {catalog && <p role="alert" className="error">Stemcatalogus niet beschikbaar ({catalog.error}); vaste lijst getoond.</p>}
                  <ActionForm action={setVoice} label="Stem zetten" pendingLabel="Zet…" id={dynimo.id}>
                    <select name="voice" aria-label="Stem" defaultValue={dynimo.voice ?? ""}>
                      <option value="">standaard</option>
                      {provider === "elevenlabs" && dynimo.voice && !voices.includes(dynimo.voice) && <option value={dynimo.voice}>{dynimo.voice} (uit catalogus)</option>}
                      {voices.map((voice) => (
                        <option key={voice} value={voice}>
                          {voice}
                        </option>
                      ))}
                    </select>
                    <input name="voiceDescription" aria-label="Stembeschrijving" placeholder="Stembeschrijving (bv. warm, laag, rustig)" maxLength={500} defaultValue={dynimo.voiceDescription ?? ""} />
                  </ActionForm>
                    </>
                  )}
                  {provider === "elevenlabs" && (
                    <VoiceDesign blocked={freeTier} id={dynimo.id} name={dynimo.name} description={dynimo.voiceDescription ?? getArchetype(dynimo.archetype)?.voiceHint ?? ""} />
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
                    <ActionForm action={addMemory} label="Herinnering toevoegen" pendingLabel="Onthoudt…" id={dynimo.id}>
                      <input name="text" placeholder="Wat moet hij onthouden?" aria-label="Nieuwe herinnering" required />
                    </ActionForm>
                    {recentMemories[index]!.length ? (
                      <ul>
                        {recentMemories[index]!.map((memory) => (
                          <li key={memory.id}>
                            <time dateTime={memory.createdAt.toISOString()}>{formatDateTime(memory.createdAt)}</time>
                            <p style={{ whiteSpace: "pre-wrap" }}>{memory.text}</p>
                            <ActionForm action={removeMemory} label="Verwijderen" pendingLabel="Verwijdert…" id={dynimo.id}>
                              <input type="hidden" name="memoryId" value={memory.id} />
                            </ActionForm>
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
