import type { Metadata } from "next";
import { getBrain } from "../../lib/brain";
import { formatDate } from "../../lib/format";
import { ActionForm } from "../action-form";
import { deletePerson, mergePersons, relearnPerson, renamePerson } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Personen" };

// Personen (#95, herontwerp #130): dun bovenop de brain-functies, in het nieuwe visuele systeem (#128/#129).
export default async function PersonenPage() {
  const persons = await getBrain().listPersons();

  // Dubbele namen (hoofdletterongevoelig, getrimd) vallen op met een badge en een samenvoeg-snelkoppeling.
  const namesakesOf = (person: (typeof persons)[number]) => {
    const key = person.name.trim().toLowerCase();
    return persons.filter((other) => other.id !== person.id && other.name.trim().toLowerCase() === key);
  };

  return (
    <>
      <header className="page-head">
        <h1>Personen</h1>
      </header>
      <section className="section">
        {persons.length ? (
          <ul className="persons">
            {persons.map((person) => {
              const namesakes = namesakesOf(person);
              return (
                <li key={person.id} className="card">
                  <div className="section-head">
                    <h2>
                      {person.name} {person.owner && <span className="badge badge-strong">eigenaar</span>}
                      {namesakes.length > 0 && <span className="badge badge-danger">dubbele naam</span>}
                    </h2>
                    <p className="small muted">Aangemaakt: {formatDate(person.createdAt)}</p>
                  </div>

                  <dl className="stats">
                    <div className="stat">
                      <dt>Gezichten</dt>
                      <dd>{person.faceCount}</dd>
                    </div>
                    <div className="stat">
                      <dt>Stemprofielen</dt>
                      <dd>{person.voiceCount}</dd>
                    </div>
                    <div className="stat">
                      <dt>Herinneringen</dt>
                      <dd>{person.memoryCount}</dd>
                    </div>
                  </dl>

                  {namesakes.length > 0 && (
                    <p className="small">
                      Voeg samen met {namesakes.map((n) => n.name).join(", ")}:{" "}
                      {namesakes.map((other) => (
                        <ActionForm
                          key={other.id}
                          action={mergePersons}
                          label={`Voeg samen in ${other.name}`}
                          pendingLabel="Voegt samen…"
                          id={other.id}
                          confirmName
                          danger
                        >
                          <input type="hidden" name="removeId" value={person.id} />
                        </ActionForm>
                      ))}
                    </p>
                  )}

                  <ActionForm action={renamePerson} label="Hernoemen" pendingLabel="Hernoemt…" id={person.id}>
                    <input name="name" placeholder="Nieuwe naam" aria-label="Nieuwe naam" defaultValue={person.name} required />
                  </ActionForm>

                  {persons.length > 1 + namesakes.length && (
                    <details>
                      <summary className="small">Samenvoegen met een andere Persoon…</summary>
                      <ul className="action-stack">
                        {persons
                          .filter((other) => other.id !== person.id && !namesakes.some((n) => n.id === other.id))
                          .map((other) => (
                            <li key={other.id}>
                              {/* Richting expliciet in het label: {person.name} (removeId) verdwijnt in {other.name} (keepId). */}
                              <ActionForm
                                action={mergePersons}
                                label={`Voeg ${person.name} samen in ${other.name} — ${person.name} verdwijnt`}
                                pendingLabel="Voegt samen…"
                                id={other.id}
                                confirmName
                                danger
                              >
                                <input type="hidden" name="removeId" value={person.id} />
                              </ActionForm>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}

                  <div className="action">
                    <ActionForm action={relearnPerson} label="Opnieuw leren" pendingLabel="Wist…" id={person.id} danger confirm={`${person.name} opnieuw laten leren? Gezichten en stemprofielen worden gewist.`} />
                    {!person.owner && (
                      <ActionForm action={deletePerson} label="Verwijderen" pendingLabel="Verwijdert…" id={person.id} confirmName danger />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">
            <p className="muted">Nog geen Personen bekend. Ze ontstaan zodra een Dynimo iemand leert kennen.</p>
          </div>
        )}
      </section>
    </>
  );
}
