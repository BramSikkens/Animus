import type { Metadata } from "next";
import { type2Catalog } from "@animus/core/config";
import { getAnimus } from "../../lib/animus";
import { ActionForm } from "../action-form";
import { resetType2Models, setType2Models } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Model" };

const SLOTS = [
  { name: "light", label: "Licht", hint: "Gewone beurten (Intent simpel)." },
  { name: "heavy", label: "Zwaar", hint: "Complexe beurten, Reflectie, genesis en afscheid." },
] as const;

// Modelwissel (#132): het globale Type2-model voor wie er wakker is. Elke Herinnering onthoudt welk model haar schreef.
export default async function ModelPage() {
  const animus = getAnimus();
  const available = animus.availableModels();
  const active = await animus.type2Models();
  const { defaults } = type2Catalog();

  return (
    <>
      <header className="page-head">
        <h1>Model</h1>
        {!active.isDefault && <ActionForm action={resetType2Models} label="Terug naar standaard" pendingLabel="Zet terug…" />}
      </header>
      <p className="page-note">
        Welk Type2-model het praat-brein is. Een wissel geldt vanaf de volgende beurt, zonder herstart; op de pagina van een
        Dynimo zie je per Herinnering welk model ze schreef. Enkel modellen van providers met een sleutel in .env staan in de lijst.
      </p>

      <section className="section">
        <ActionForm action={setType2Models} label="Model wisselen" pendingLabel="Wisselt…" stacked>
          {SLOTS.map((slot) => (
            <label key={slot.name} className="field">
              <span className="field-label">
                {slot.label} · {slot.hint}
              </span>
              <select name={slot.name} defaultValue={active[slot.name] === defaults[slot.name] ? "" : active[slot.name]}>
                <option value="">Standaard ({defaults[slot.name]})</option>
                {available.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </ActionForm>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Nu actief</h2>
          <span className={active.isDefault ? "badge" : "badge badge-strong"}>{active.isDefault ? "standaard" : "gewisseld"}</span>
        </div>
        <dl className="defs">
          <dt>Licht</dt>
          <dd>{active.light}</dd>
          <dt>Zwaar</dt>
          <dd>{active.heavy}</dd>
        </dl>
      </section>
    </>
  );
}
