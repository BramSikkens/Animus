import { getBrain } from "../../lib/brain";
import { ActionForm } from "../action-form";
import { deletePerson, mergePersons, relearnPerson, renamePerson } from "../actions";
import { formatDate } from "../../lib/format";

export const dynamic = "force-dynamic";

// Personen (#95): dun bovenop de brain-functies, in de stijl van de hoofdpagina.
export default async function PersonenPage() {
  const persons = await getBrain().listPersons();

  return (
    <main>
      <h1>Animus — Personen</h1>
      <p>
        <a href="/">← Terug naar het dashboard</a>
      </p>
      <section>
        <h2>Personen</h2>
        {persons.length ? (
          <ul>
            {persons.map((person) => (
              <li key={person.id}>
                <h3>
                  {person.name}
                  {person.owner && " (eigenaar)"}
                </h3>
                <p>
                  Aangemaakt: {formatDate(person.createdAt)} · Gezichten: {person.faceCount} · Stemprofielen: {person.voiceCount} · Herinneringen: {person.memoryCount}
                </p>
                <ActionForm action={renamePerson} label="Hernoemen" pendingLabel="Hernoemt…" id={person.id}>
                  <input name="name" placeholder="Nieuwe naam" aria-label="Nieuwe naam" defaultValue={person.name} required />
                </ActionForm>
                {persons.length > 1 && (
                  <details>
                    <summary>Samenvoegen in…</summary>
                    <ul>
                      {persons
                        .filter((other) => other.id !== person.id)
                        .map((other) => (
                          <li key={other.id}>
                            {/* Richting expliciet in het label: {person.name} (removeId) verdwijnt in {other.name} (keepId). */}
                            <ActionForm
                              action={mergePersons}
                              label={`Voeg ${person.name} samen in ${other.name} — ${person.name} verdwijnt`}
                              pendingLabel="Voegt samen…"
                              id={other.id}
                              confirmName
                            >
                              <input type="hidden" name="removeId" value={person.id} />
                            </ActionForm>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
                <ActionForm action={relearnPerson} label="Opnieuw leren" pendingLabel="Wist…" id={person.id} />
                {!person.owner && <ActionForm action={deletePerson} label="Verwijderen" pendingLabel="Verwijdert…" id={person.id} confirmName />}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nog geen Personen bekend.</p>
        )}
      </section>
    </main>
  );
}
