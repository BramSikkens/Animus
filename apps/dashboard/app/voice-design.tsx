"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "./action-form";
import { cloneVoiceAction, designVoiceAction, applyDesignedVoice } from "./actions";

const DEFAULT_TEXT =
  "Hallo, leuk je te ontmoeten. Ik vertel je graag over mijn dag, over wat ik heb gezien en over de dingen die mij bezighouden. Waar zullen we het eens over hebben?";

// Eigen stem ontwerpen (beschrijving -> 3 previews -> gebruiken) of kloneren uit een eigen opname.
export function VoiceDesign({ id, name, description }: { id: number; name: string; description: string }) {
  const [state, formAction, pending] = useActionState(designVoiceAction, {});
  const [text, setText] = useState(description);
  return (
    <details>
      <summary>Eigen stem ontwerpen of kloneren</summary>
      <p>
        Beschrijf de stem in het Nederlands, luister naar de previews en kies er een. Geen stemmen van bestaande personen of filmkarakters
        zonder toestemming.
      </p>
      <form action={formAction} className="action">
        <textarea name="description" aria-label="Stembeschrijving" maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Bv. oude dame, warm, zacht trillend, rustig tempo" />
        <textarea name="previewText" aria-label="Previewtekst (Nederlands, 100 tot 1000 tekens)" minLength={100} maxLength={1000} required defaultValue={DEFAULT_TEXT} />
        <button type="submit" disabled={pending}>
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
              <ActionForm action={applyDesignedVoice} label="Gebruik deze" pendingLabel="Slaat op…" id={id}>
                <input type="hidden" name="generatedVoiceId" value={preview.generatedVoiceId} />
                <input type="hidden" name="description" value={text} />
                <input name="name" aria-label="Naam van de stem" placeholder="Naam van de stem" defaultValue={name} required />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <h4>Kloneren uit een eigen opname</h4>
      <ActionForm action={cloneVoiceAction} label="Kloon stem en gebruik" pendingLabel="Kloont…" id={id}>
        <input name="name" aria-label="Naam van de stem" placeholder="Naam van de stem" defaultValue={name} required />
        <input type="file" name="files" accept="audio/*" multiple required aria-label="Audio-opname (max 10 MB per bestand)" />
        <label>
          <input type="checkbox" name="consent" required /> Ik heb het recht deze stem te gebruiken
        </label>
      </ActionForm>
    </details>
  );
}
