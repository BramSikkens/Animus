"use client";

import { useActionState, useState } from "react";
import { FREE_TIER_MESSAGE } from "@animus/brain/voice-catalog";
import { ActionForm } from "./action-form";
import { cloneVoiceAction, designVoiceAction, applyDesignedVoice } from "./actions";
import type { DynimoOption } from "./voice-catalog";

const DEFAULT_TEXT =
  "Hallo, leuk je te ontmoeten. Ik vertel je graag over mijn dag, over wat ik heb gezien en over de dingen die mij bezighouden. Waar zullen we het eens over hebben?";

const COST_NOTICE = "Dit verbruikt ElevenLabs-tegoed.";
const COST_CONFIRM = `${COST_NOTICE} Doorgaan?`;

// Ontwerp/kloon-formulieren voor één gekozen Dynimo. Gekeyed op id door de aanroeper, zodat wisselen van Dynimo
// de previews en velden weer op de standaardwaarden van die Dynimo zet.
function VoiceDesignForDynimo({ id, name, description, blocked }: { id: number; name: string; description: string; blocked: boolean }) {
  const [state, formAction, pending] = useActionState(designVoiceAction, {});
  const [text, setText] = useState(description);
  return (
    <>
      {blocked && (
        <p role="alert" className="error">
          Stem ontwerpen en klonen {FREE_TIER_MESSAGE}. Je ElevenLabs-account is nu gratis.
        </p>
      )}
      <form
        action={formAction}
        className="action"
        onSubmit={(event) => {
          if (!window.confirm(COST_CONFIRM)) event.preventDefault();
        }}
      >
        <textarea name="description" aria-label="Stembeschrijving" maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Bv. oude dame, warm, zacht trillend, rustig tempo" />
        <textarea name="previewText" aria-label="Previewtekst (Nederlands, 100 tot 1000 tekens)" minLength={100} maxLength={1000} required defaultValue={DEFAULT_TEXT} />
        <p className="small muted">{COST_NOTICE}</p>
        <button type="submit" disabled={pending || blocked}>
          {pending ? "Ontwerpt…" : "Previews maken"}
        </button>
        {state.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
      </form>
      {state.previews && (
        <ul>
          {state.previews.map((preview, index) => (
            <li key={preview.generatedVoiceId}>
              Preview {index + 1} <audio controls src={`data:${preview.mediaType};base64,${preview.audioBase64}`} />
              <ActionForm action={applyDesignedVoice} label="Gebruik deze" pendingLabel="Slaat op…" id={id} disabled={blocked}>
                <input type="hidden" name="generatedVoiceId" value={preview.generatedVoiceId} />
                <input type="hidden" name="description" value={text} />
                <input name="name" aria-label="Naam van de stem" placeholder="Naam van de stem" defaultValue={name} required />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <h4>Kloneren uit een eigen opname</h4>
      <p className="small muted">{COST_NOTICE}</p>
      <ActionForm action={cloneVoiceAction} label="Kloon stem en gebruik" pendingLabel="Kloont…" id={id} disabled={blocked} confirm={COST_CONFIRM}>
        <input name="name" aria-label="Naam van de stem" placeholder="Naam van de stem" defaultValue={name} required />
        <input type="file" name="files" accept="audio/*" multiple required aria-label="Audio-opname (max 10 MB per bestand)" />
        <label>
          <input type="checkbox" name="consent" required /> Ik heb het recht deze stem te gebruiken
        </label>
      </ActionForm>
    </>
  );
}

// Eigen stem ontwerpen (beschrijving -> 3 previews -> gebruiken) of kloneren uit een eigen opname, voor een te kiezen Dynimo.
export function VoiceDesign({ dynimos, blocked }: { dynimos: DynimoOption[]; blocked: boolean }) {
  const [selectedId, setSelectedId] = useState(dynimos[0]?.id ?? 0);
  const selected = dynimos.find((d) => d.id === selectedId) ?? dynimos[0];
  if (!selected) return null;

  return (
    <details>
      <summary>Eigen stem ontwerpen of kloneren</summary>
      <p>
        Beschrijf de stem in het Nederlands, luister naar de previews en kies er een. Geen stemmen van bestaande personen of filmkarakters
        zonder toestemming.
      </p>
      <label>
        Voor Dynimo
        <select value={selected.id} onChange={(e) => setSelectedId(Number(e.target.value))} aria-label="Voor welke Dynimo">
          {dynimos.map((dynimo) => (
            <option key={dynimo.id} value={dynimo.id}>
              {dynimo.name}
            </option>
          ))}
        </select>
      </label>
      <VoiceDesignForDynimo key={selected.id} id={selected.id} name={selected.name} description={selected.voiceDescription ?? ""} blocked={blocked} />
    </details>
  );
}
