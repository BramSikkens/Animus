"use client";

import { useState } from "react";
import { filterVoices, FREE_TIER_MESSAGE, type CatalogVoice } from "@animus/core/voice-catalog";
import { ActionForm } from "./action-form";
import { setVoice } from "./actions";

const SHOWN = 30;

export type DynimoOption = { id: number; name: string; voiceDescription: string | null };

// Toewijzen van één stem aan een gekozen Dynimo (select), met de huidige beschrijving van die Dynimo als startpunt
// zodat toewijzen de beschrijving niet onbedoeld wist (setVoice zet een lege beschrijving op null).
function AssignVoice({ voiceId, dynimos }: { voiceId: string; dynimos: DynimoOption[] }) {
  const [targetId, setTargetId] = useState(dynimos[0]!.id);
  const [description, setDescription] = useState(dynimos[0]!.voiceDescription ?? "");

  function onTargetChange(id: number) {
    setTargetId(id);
    setDescription(dynimos.find((d) => d.id === id)?.voiceDescription ?? "");
  }

  return (
    <ActionForm action={setVoice} label="Toewijzen" pendingLabel="Wijst toe…" stacked>
      <input type="hidden" name="voice" value={voiceId} />
      <select name="id" aria-label="Toewijzen aan" value={targetId} onChange={(e) => onTargetChange(Number(e.target.value))}>
        {dynimos.map((dynimo) => (
          <option key={dynimo.id} value={dynimo.id}>
            {dynimo.name}
          </option>
        ))}
      </select>
      <input
        name="voiceDescription"
        aria-label="Stembeschrijving"
        placeholder="Stembeschrijving"
        maxLength={500}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </ActionForm>
  );
}

// Stemcatalogus (Stemmen-pagina, #131): filter/zoek, voorluisteren, toewijzen aan een gekozen Dynimo.
export function VoiceCatalog({ voices, dynimos }: { voices: CatalogVoice[]; dynimos: DynimoOption[] }) {
  const [text, setText] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [language, setLanguage] = useState("nl");
  const found = filterVoices(voices, { text, gender, age, language });

  return (
    <details open>
      <summary>Stemcatalogus ({voices.length} stemmen)</summary>
      <p>
        Zoek een stem die past bij het karakter, &quot;in de geest van&quot; een type (bv. oude man, wijze vrouw). Geen stemmen van bestaande
        personen of filmkarakters.
      </p>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Zoek (naam, beschrijving, accent)" aria-label="Zoek stem" />
      <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Geslacht">
        <option value="">geslacht: alle</option>
        <option value="female">vrouw</option>
        <option value="male">man</option>
        <option value="neutral">neutraal</option>
      </select>
      <select value={age} onChange={(e) => setAge(e.target.value)} aria-label="Leeftijd">
        <option value="">leeftijd: alle</option>
        <option value="young">jong</option>
        <option value="middle_aged">middelbaar</option>
        <option value="old">oud</option>
      </select>
      <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Taal">
        <option value="nl">Nederlands (en meertalig)</option>
        <option value="">alle talen</option>
      </select>
      <p>
        {found.length} gevonden{found.length > SHOWN ? `, de eerste ${SHOWN} getoond` : ""}
      </p>
      <ul>
        {found.slice(0, SHOWN).map((voice) => (
          <li key={voice.id}>
            <strong>{voice.name}</strong> {[voice.gender, voice.age, voice.accent, voice.language, voice.useCase].filter(Boolean).join(" · ")}
            {voice.description && <div>{voice.description}</div>}
            {voice.previewUrl && <audio controls preload="none" src={voice.previewUrl} />}
            {voice.usableOnFree ? (
              <AssignVoice voiceId={voice.id} dynimos={dynimos} />
            ) : (
              <em>{FREE_TIER_MESSAGE}</em>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
