import { and, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatAge } from "@animus/core/age";
import { ARCHETYPES, getArchetype } from "@animus/core/archetypes";
import { DRIVE_KINDS, DRIVE_LABELS, type DriveKind } from "@animus/core/drives";
import { EMOTIONS, EMOTION_GROUPS } from "@animus/core/emotion";
import { FAMILIARITY_DEFAULT, familiarityStyle } from "@animus/core/familiarity";
import { displayMoodOfRow, moodOfRow } from "@animus/core/mood";
import { AXES, AXIS_LABELS, AXIS_LETTERS, MBTI_AXES, mbtiType, rowAxes } from "@animus/core/personality";
import { verstandBand } from "@animus/core/verstand";
import { speechProvider, voicesFor } from "@animus/core/voice";
import { dreams, drives, dynimos, familiarities, memories, persons } from "@animus/db/schema";
import { db } from "../../../lib/db";
import { formatDate, formatDateTime } from "../../../lib/format";
import { ActionForm } from "../../action-form";
import { addMemory, forceMood, kill, removeMemory, setArchetype, setAxes, setFamiliarity, setMood, setVerstand, setVoice, sleep, wake } from "../../actions";
import { MoodStrip } from "../../mood-strip";

export const dynamic = "force-dynamic";

const RECENT_DREAMS_LIMIT = 5;
const MEMORIES_PAGE = 20;

// Postgres "undefined_table": de database is nog niet gemigreerd.
const UNDEFINED_TABLE = "42P01";

type SearchParams = { persoon?: string; meer?: string };

async function loadDynimo(id: number) {
  const [dynimo] = await db.select().from(dynimos).where(eq(dynimos.id, id));
  if (!dynimo) return null;

  const [driveRows, dreamRows, personRows, familiarityRows, memoryPersonRows] = await Promise.all([
    db.select().from(drives).where(and(eq(drives.dynimoId, id), isNull(drives.droppedAt))).orderBy(drives.id),
    db.select().from(dreams).where(eq(dreams.dynimoId, id)).orderBy(desc(dreams.createdAt), desc(dreams.id)).limit(RECENT_DREAMS_LIMIT),
    db.select({ id: persons.id, name: persons.name, owner: persons.owner }).from(persons).orderBy(desc(persons.owner), persons.name),
    db.select({ personId: familiarities.personId, familiarity: familiarities.familiarity }).from(familiarities).where(eq(familiarities.dynimoId, id)),
    db.selectDistinct({ personId: memories.personId }).from(memories).where(eq(memories.dynimoId, id)),
  ]);

  return { dynimo, driveRows, dreamRows, personRows, familiarityRows, memoryPersonRows };
}

async function loadMemories(id: number, { personFilter, limit }: { personFilter: { kind: "onbekend" | "persoon"; personId?: number } | null; limit: number }) {
  const where =
    personFilter === null
      ? eq(memories.dynimoId, id)
      : personFilter.kind === "onbekend"
        ? and(eq(memories.dynimoId, id), isNull(memories.personId))
        : and(eq(memories.dynimoId, id), eq(memories.personId, personFilter.personId!));
  const rows = await db
    .select({ id: memories.id, personId: memories.personId, model: memories.model, impression: memories.impression, text: memories.text, createdAt: memories.createdAt })
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return {};
  try {
    const [row] = await db.select({ name: dynimos.name }).from(dynimos).where(eq(dynimos.id, id));
    return { title: row?.name };
  } catch {
    return {};
  }
}

// Parseert het `persoon`-filter uit de zoekparameters (#129): geen waarde = Iedereen, "onbekend" = person_id null,
// een getal = die Persoon. Een ongeldige waarde valt terug op Iedereen.
function parsePersonFilter(raw: string | undefined): { kind: "onbekend" | "persoon"; personId?: number } | null {
  if (!raw) return null;
  if (raw === "onbekend") return { kind: "onbekend" };
  const personId = Number(raw);
  return Number.isInteger(personId) && personId > 0 ? { kind: "persoon", personId } : null;
}

function memoriesHref(id: number, overrides: SearchParams, current: SearchParams): string {
  const merged = { ...current, ...overrides };
  const search = new URLSearchParams();
  if (merged.persoon) search.set("persoon", merged.persoon);
  if (merged.meer) search.set("meer", merged.meer);
  const qs = search.toString();
  return `/dynimo/${id}${qs ? `?${qs}` : ""}`;
}

export default async function DynimoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;

  let base: Awaited<ReturnType<typeof loadDynimo>>;
  try {
    base = await loadDynimo(id);
  } catch (error) {
    // Drizzle wikkelt de Postgres-fout in; de code zit op de fout zelf of op `cause`.
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    if ((code ?? cause?.code) !== UNDEFINED_TABLE) throw error;
    return (
      <p>
        De database is nog niet gemigreerd. Draai <code>pnpm db:migrate</code> (of start <code>pnpm dev</code>).
      </p>
    );
  }
  if (!base) notFound();
  const { dynimo, driveRows, dreamRows, personRows, familiarityRows, memoryPersonRows } = base;

  const personFilter = parsePersonFilter(sp.persoon);
  const memoriesLimit = (() => {
    const n = Number(sp.meer);
    return Number.isInteger(n) && n > MEMORIES_PAGE ? n : MEMORIES_PAGE;
  })();
  const { rows: memoryRows, hasMore } = await loadMemories(id, { personFilter, limit: memoriesLimit });

  const now = new Date();
  const awake = dynimo.awakeSince !== null;
  const axes = rowAxes(dynimo);
  const archetype = getArchetype(dynimo.archetype);
  const moodValues = moodOfRow(dynimo, now).values;
  const dominant = awake ? displayMoodOfRow(dynimo, now).emotion : undefined;

  const familiarityByPerson = new Map(familiarityRows.map((row) => [row.personId, row.familiarity]));
  const owner = personRows.find((person) => person.owner);
  const ownerFamiliarity = owner ? (familiarityByPerson.get(owner.id) ?? FAMILIARITY_DEFAULT) : FAMILIARITY_DEFAULT;

  const memoryPersonIds = new Set(memoryPersonRows.map((row) => row.personId).filter((personId): personId is number => personId !== null));
  const hasUnknownMemories = memoryPersonRows.some((row) => row.personId === null);
  const personById = new Map(personRows.map((person) => [person.id, person.name]));

  const provider = speechProvider(process.env);
  const voices = voicesFor(provider);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="band-name">
            <span className={awake ? "awake-dot" : "asleep-dot"} aria-hidden="true" />
            {dynimo.name}
          </h1>
          <p className="band-meta">
            {awake ? "wakker" : "slaapt"} · {formatAge(now.getTime() - dynimo.bornAt.getTime())}
            {archetype && ` · ${archetype.name}`}
            {axes && ` · ${mbtiType(axes)}`}
          </p>
        </div>
        {awake ? (
          <ActionForm action={sleep} label="Laten slapen" pendingLabel="Valt in slaap…" />
        ) : (
          <ActionForm action={wake} label="Wakker maken" pendingLabel="Wordt wakker…" id={dynimo.id} />
        )}
      </header>

      <MoodStrip values={moodValues} dominant={dominant} />

      <dl className="stats">
        <div className="stat">
          <dt>Basisemotie</dt>
          <dd>{dynimo.baseEmotion ?? "nog niet bepaald"}</dd>
        </div>
        <div className="stat">
          <dt>Verstand</dt>
          <dd>{dynimo.verstand === null ? "(leeg)" : `${verstandBand(dynimo.verstand)} (${dynimo.verstand.toFixed(2)})`}</dd>
        </div>
        <div className="stat">
          <dt>Vertrouwdheid eigenaar</dt>
          <dd>
            {familiarityStyle(ownerFamiliarity).band} ({ownerFamiliarity.toFixed(2)})
          </dd>
        </div>
        <div className="stat">
          <dt>Geboren</dt>
          <dd>{formatDate(dynimo.bornAt)}</dd>
        </div>
      </dl>

      <section className="section">
        <div className="section-head">
          <h2>Karakter</h2>
        </div>
        <dl className="defs">
          <dt>Kern-karakter</dt>
          <dd className="prose">{dynimo.coreCharacter}</dd>
          {dynimo.evolvedCharacter && (
            <>
              <dt>Geëvolueerd karakter</dt>
              <dd className="prose">{dynimo.evolvedCharacter}</dd>
            </>
          )}
        </dl>
        <details>
          <summary>Geboorteverhaal</summary>
          <p className="prose">{dynimo.birthStory}</p>
        </details>
        <p className="small muted">Seed: {dynimo.seed}</p>

        <h3>Persoonlijkheid</h3>
        {axes ? (
          <>
            <p>
              MBTI-type: <strong>{mbtiType(axes)}</strong>
            </p>
            {MBTI_AXES.map((axis) => {
              const percent = Math.round(axes[axis] * 100);
              const [first, second] = AXIS_LETTERS[axis];
              return (
                <div key={axis} className="axis-bar">
                  <span>{first}</span>
                  <div className="mood-track" role="meter" aria-label={`${first}↔${second}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <div className="mood-fill" style={{ width: `${percent}%` }} />
                  </div>
                  <span>{second}</span>
                </div>
              );
            })}
          </>
        ) : (
          <p className="muted">Persoonlijkheid nog niet bepaald.</p>
        )}
        <ActionForm action={setAxes} label="Persoonlijkheid zetten" pendingLabel="Zet…" id={dynimo.id} stacked>
          {AXES.map((axis) => (
            <label key={axis} className="slider">
              {AXIS_LABELS[axis]}
              <input name={`axis_${axis}`} type="range" min={0} max={1} step={0.01} defaultValue={axes?.[axis] ?? 0.5} />
            </label>
          ))}
        </ActionForm>
        <ActionForm action={setVerstand} label="Verstand zetten" pendingLabel="Zet…" id={dynimo.id} stacked>
          <label className="slider">
            Verstand
            <input name="verstand" type="range" min={0} max={1} step={0.01} defaultValue={dynimo.verstand ?? 0.5} />
          </label>
        </ActionForm>
        <ActionForm
          action={setArchetype}
          label="Archetype toepassen"
          pendingLabel="Zet…"
          id={dynimo.id}
          confirm="Dit overschrijft de Persoonlijkheidsassen en de Basisemotie. Doorgaan?"
        >
          <select name="archetype" aria-label="Archetype" defaultValue={archetype?.id ?? ARCHETYPES[0]!.id}>
            {ARCHETYPES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </ActionForm>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Stemming</h2>
        </div>
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
        <ActionForm action={setMood} label="Stemming zetten" pendingLabel="Zet…" id={dynimo.id} stacked>
          {EMOTION_GROUPS.map((group) => (
            <div key={group[0]} className="slider-group">
              {group.map((emotion) => (
                <label key={emotion} className="slider">
                  {emotion}
                  <input name={`mood_${emotion}`} type="range" min={0} max={100} step={1} defaultValue={Math.round(moodValues[emotion])} />
                </label>
              ))}
            </div>
          ))}
        </ActionForm>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Relaties</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Persoon</th>
                <th>Band</th>
                <th className="num">Waarde</th>
                <th>Vertrouwdheid zetten</th>
              </tr>
            </thead>
            <tbody>
              {personRows.map((person) => {
                const familiarity = familiarityByPerson.get(person.id) ?? FAMILIARITY_DEFAULT;
                return (
                  <tr key={person.id}>
                    <td>
                      {person.name} {person.owner && <span className="badge badge-strong">eigenaar</span>}
                    </td>
                    <td>{familiarityStyle(familiarity).band}</td>
                    <td className="num">{familiarity.toFixed(2)}</td>
                    <td>
                      <ActionForm action={setFamiliarity} label="Zetten" pendingLabel="Zet…" id={dynimo.id}>
                        <input type="hidden" name="personId" value={person.id} />
                        <input name="familiarity" type="range" min={0} max={1} step={0.01} defaultValue={familiarity} aria-label={`Vertrouwdheid met ${person.name}`} />
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!personRows.length && <p className="muted">Nog geen Personen bekend.</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Stem</h2>
        </div>
        <dl className="defs">
          <dt>Huidige stem</dt>
          <dd>{dynimo.voice ?? "standaard"}</dd>
          <dt>Beschrijving</dt>
          <dd>{dynimo.voiceDescription ?? "geen"}</dd>
        </dl>
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
        <p className="small">
          <Link href="/stemmen">Catalogus, ontwerpen en klonen op de Stemmen-pagina →</Link>
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Drijfveren en Dromen</h2>
        </div>
        <h3>Drijfveren</h3>
        {DRIVE_KINDS.map((kind: DriveKind) => {
          const ofKind = driveRows.filter((drive) => drive.kind === kind);
          return (
            <div key={kind}>
              <h4>{DRIVE_LABELS[kind]}</h4>
              {ofKind.length ? (
                <ul>
                  {ofKind.map((drive) => (
                    <li key={drive.id}>
                      {drive.text} {drive.status && <span className="badge">{drive.status}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">nog geen</p>
              )}
            </div>
          );
        })}
        <h3>Dromen</h3>
        {dreamRows.length ? (
          <ul>
            {dreamRows.map((dream) => (
              <li key={dream.id}>
                <time dateTime={dream.createdAt.toISOString()}>{formatDateTime(dream.createdAt)}</time>{" "}
                <span className="badge">
                  {dream.emotion} · {Math.round(dream.intensity * 100)}%
                </span>
                <p className="prose">{dream.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">nog geen</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Herinneringen</h2>
        </div>
        <ActionForm action={addMemory} label="Herinnering toevoegen" pendingLabel="Onthoudt…" id={dynimo.id}>
          <input name="text" placeholder="Wat moet hij onthouden?" aria-label="Nieuwe herinnering" required />
        </ActionForm>
        <p className="action">
          <Link className={personFilter === null ? "badge badge-strong" : "badge"} href={memoriesHref(id, { persoon: undefined, meer: undefined }, sp)}>
            Iedereen
          </Link>
          {personRows
            .filter((person) => memoryPersonIds.has(person.id))
            .map((person) => (
              <Link
                key={person.id}
                className={personFilter?.kind === "persoon" && personFilter.personId === person.id ? "badge badge-strong" : "badge"}
                href={memoriesHref(id, { persoon: String(person.id), meer: undefined }, sp)}
              >
                {person.name}
              </Link>
            ))}
          {hasUnknownMemories && (
            <Link className={personFilter?.kind === "onbekend" ? "badge badge-strong" : "badge"} href={memoriesHref(id, { persoon: "onbekend", meer: undefined }, sp)}>
              Onbekend
            </Link>
          )}
        </p>
        {memoryRows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Persoon</th>
                  <th>Model</th>
                  <th className="num">Indruk</th>
                  <th>Tekst</th>
                  <th>Verwijderen</th>
                </tr>
              </thead>
              <tbody>
                {memoryRows.map((memory) => (
                  <tr key={memory.id}>
                    <td>
                      <time dateTime={memory.createdAt.toISOString()}>{formatDateTime(memory.createdAt)}</time>
                    </td>
                    <td>{memory.personId === null ? "onbekend" : (personById.get(memory.personId) ?? "onbekend")}</td>
                    <td className="muted">{memory.model ?? "—"}</td>
                    <td className="num">{memory.impression.toFixed(2)}</td>
                    <td className="prose">{memory.text}</td>
                    <td>
                      <ActionForm action={removeMemory} label="Verwijderen" pendingLabel="Verwijdert…" id={dynimo.id} danger confirm="Deze Herinnering verwijderen?">
                        <input type="hidden" name="memoryId" value={memory.id} />
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">nog geen</p>
        )}
        {hasMore && (
          <p className="small">
            <Link href={memoriesHref(id, { meer: String(memoriesLimit + MEMORIES_PAGE) }, sp)}>Meer tonen</Link>
          </p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Gevaarzone</h2>
        </div>
        <div className="card card-danger">
          <p className="prose">Doden verwijdert deze Dynimo. Het Grafschrift blijft bewaard (ADR-0003).</p>
          <ActionForm action={kill} label="Doden" pendingLabel="Neemt afscheid…" id={dynimo.id} confirmName danger />
        </div>
      </section>
    </>
  );
}
