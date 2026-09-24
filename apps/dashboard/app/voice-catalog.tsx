"use client";

import { useState } from "react";
import { filterVoices, FREE_TIER_MESSAGE, type CatalogVoice } from "@animus/brain/voice-catalog";
import { ActionForm } from "./action-form";
import { setVoice } from "./actions";

const SHOWN = 30;

// Catalogus per Dynimo: filter/zoek, voorluisteren, kiezen. `hint` en `description` zijn klik-om-te-zoeken suggesties.
// ponytail: de lijst wordt per Dynimo meegestuurd; één gedeelde client-store als het aantal Dynimo's groeit.
export function VoiceCatalog({
  id,
  voices,
  current,
  description,
  hint,
}: {
  id: number;
  voices: CatalogVoice[];
  current: string | null;
  description: string;
  hint: string;
}) {
  const [text, setText] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [language, setLanguage] = useState("nl");
  const [selected, setSelected] = useState(current ?? "");
  const found = filterVoices(voices, { text, gender, age, language });
  const suggestions = [...new Set(`${hint},${description}`.split(/[,;]/).map((part) => part.trim()).filter(Boolean))];

  return (
    <details>
      <summary>Stemcatalogus ({voices.length} stemmen)</summary>
      <p>
        Zoek een stem die past bij het karakter, &quot;in de geest van&quot; een type (bv. oude man, wijze vrouw). Geen stemmen van bestaande
        personen of filmkarakters.
      </p>
      {suggestions.length > 0 && (
        <p>
          Suggestie:{" "}
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setText(suggestion)}>
              {suggestion}
            </button>
          ))}
        </p>
      )}
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
              <button type="button" onClick={() => setSelected(voice.id)} aria-pressed={selected === voice.id}>
                {selected === voice.id ? "Gekozen" : "Kies"}
              </button>
            ) : (
              <em>{FREE_TIER_MESSAGE}</em>
            )}
          </li>
        ))}
      </ul>
      <ActionForm action={setVoice} label="Gekozen stem zetten" pendingLabel="Zet…" id={id}>
        <input type="hidden" name="voice" value={selected} />
        <input name="voiceDescription" aria-label="Stembeschrijving" placeholder="Stembeschrijving" maxLength={500} defaultValue={description} />
        <p>
          Gekozen: {selected || "standaard"}{" "}
          <button type="button" onClick={() => setSelected("")}>
            Standaard
          </button>
        </p>
      </ActionForm>
    </details>
  );
}
