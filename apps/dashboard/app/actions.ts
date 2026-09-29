"use server";

import { revalidatePath } from "next/cache";
import { parseArchetypeId } from "@animus/core/archetypes";
import { isEmotion } from "@animus/core/emotion";
import { parseMoodValues } from "@animus/core/mood";
import { parseFamiliarity } from "@animus/core/familiarity";
import { parseAxes } from "@animus/core/personality";
import { parseVerstand } from "@animus/core/verstand";
import { adoptVoice, cloneVoice, designVoice, saveDesignedVoice, type DesignPreview } from "@animus/core/voice-design";
import { parseVoice, speechProvider, voiceInputError } from "@animus/core/voice";
import { unusableVoiceError } from "@animus/core/voice-catalog";
import { getAnimus } from "../lib/animus";
import { getCatalog } from "../lib/voice-catalog";

export type ActionState = { error?: string };

// Een string uit `work` is een foutmelding; gooit `work`, dan wordt de fout leesbaar getoond i.p.v. te crashen.
// Revalideert de hele schil (#128): elke pagina (overzicht, Dynimo, Personen, …) toont de wijziging meteen.
async function run(work: () => Promise<string | void>): Promise<ActionState> {
  try {
    const error = await work();
    if (error) return { error };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/", "layout");
  return {};
}

function parseId(formData: FormData): number | null {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

const INVALID_ID = "Ongeldige Dynimo.";

export async function bringToLife(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return run(async () => {
    await getAnimus().bringToLife();
  });
}

export async function wake(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    if (!(await getAnimus().wake(id))) return "Deze Dynimo bestaat niet meer.";
  });
}

export async function sleep(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return run(() => getAnimus().sleep());
}

export async function kill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    if (!(await getAnimus().kill(id, String(formData.get("name") ?? "")))) {
      return "De naam klopt niet (of de Dynimo bestaat niet meer). Er is niets verwijderd.";
    }
  });
}

const DYNIMO_GONE = "Deze Dynimo bestaat niet meer.";

export async function forceMood(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const emotion = formData.get("emotion");
    const intensity = Number(formData.get("intensity"));
    if (!isEmotion(emotion)) return "Ongeldige emotie.";
    if (!(intensity >= 0 && intensity <= 1)) return "Intensiteit moet tussen 0 en 1 liggen.";
    if (!(await getAnimus().forceMood(id, emotion, intensity))) return DYNIMO_GONE;
  });
}

export async function setMood(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const values = parseMoodValues((name) => formData.get(name));
    if (!values) return "Ongeldige emotiewaarden.";
    if (!(await getAnimus().setMood(id, values))) return DYNIMO_GONE;
  });
}

export async function setAxes(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const axes = parseAxes((name) => formData.get(name));
    if (!axes) return "Ongeldige persoonlijkheidsassen.";
    if (!(await getAnimus().setAxes(id, axes))) return DYNIMO_GONE;
  });
}

export async function setFamiliarity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const familiarity = parseFamiliarity((name) => formData.get(name));
    if (familiarity === null) return "Ongeldige vertrouwdheid.";
    // Optioneel: Vertrouwdheid van een specifieke Persoon i.p.v. de eigenaar (Relaties-tabel op de Dynimo-pagina, #129).
    const rawPersonId = formData.get("personId");
    const personId = rawPersonId ? Number(rawPersonId) : undefined;
    if (personId !== undefined && !(Number.isInteger(personId) && personId > 0)) return "Ongeldige Persoon.";
    if (!(await getAnimus().setFamiliarity(id, familiarity, personId))) return DYNIMO_GONE;
  });
}

export async function setVerstand(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const verstand = parseVerstand((name) => formData.get(name));
    if (verstand === null) return "Ongeldig Verstand.";
    if (!(await getAnimus().setVerstand(id, verstand))) return DYNIMO_GONE;
  });
}

export async function setArchetype(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const archetype = parseArchetypeId(formData.get("archetype"));
    if (!archetype) return "Ongeldig archetype.";
    if (!(await getAnimus().setArchetype(id, archetype))) return DYNIMO_GONE;
  });
}

export async function setVoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const parsed = parseVoice(speechProvider(process.env), formData.get("voice"));
    if (!parsed) return "Ongeldige stem.";
    let voice = parsed.voice;
    // Op een gratis account werken bibliotheekstemmen niet; de gecachete catalogus weet dat. Is die niet beschikbaar, dan blokkeert alleen de UI.
    if (voice && speechProvider(process.env) === "elevenlabs") {
      const list = await getCatalog().catch(() => null);
      const blocked = list && unusableVoiceError(list, voice);
      if (blocked) return `Deze stem ${blocked}.`;
      // Een Voice Library-stem kent TTS pas na toevoegen aan het account.
      const picked = list?.find((v) => v.id === voice);
      if (picked) voice = await adoptVoice(fetch, elevenKey(), picked);
    }
    const description = String(formData.get("voiceDescription") ?? "").trim().slice(0, 500) || null;
    if (!(await getAnimus().setVoiceProfile(id, { voice, description }))) return DYNIMO_GONE;
  });
}

export async function addMemory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const text = String(formData.get("text") ?? "").trim();
    if (!text) return "Vul een tekst in.";
    if (!(await getAnimus().addMemory(id, text))) return DYNIMO_GONE;
  });
}

export async function removeMemory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    const memoryId = Number(formData.get("memoryId"));
    if (id === null || !Number.isInteger(memoryId)) return "Ongeldige Herinnering.";
    if (!(await getAnimus().removeMemory(id, memoryId))) return "Deze Herinnering bestaat niet (meer).";
  });
}

// Personen (#95): server actions dun bovenop de Animus-functies.
const INVALID_PERSON = "Ongeldige Persoon.";
const PERSON_GONE = "Deze Persoon bestaat niet (meer).";

export async function renamePerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_PERSON;
    const name = String(formData.get("name") ?? "");
    if (!(await getAnimus().renamePerson(id, name))) return "Ongeldige naam (of de Persoon bestaat niet meer).";
  });
}

// Bevestiging zoals bij verwijderen: de exacte naam van de Persoon die verdwijnt (removeId), vóór het samenvoegen.
export async function mergePersons(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const keepId = parseId(formData);
    const removeId = Number(formData.get("removeId"));
    if (keepId === null || !Number.isInteger(removeId) || removeId <= 0) return INVALID_PERSON;
    const remove = (await getAnimus().listPersons()).find((person) => person.id === removeId);
    if (!remove || remove.name !== String(formData.get("name") ?? "")) {
      return "De naam klopt niet (of de Persoon bestaat niet meer). Er is niets samengevoegd.";
    }
    if (!(await getAnimus().mergePersons(keepId, removeId))) return "Kan deze twee Personen niet samenvoegen.";
  });
}

export async function relearnPerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_PERSON;
    if (!(await getAnimus().relearnPerson(id))) return PERSON_GONE;
  });
}

// Zoals kill(): de exacte naam ter bevestiging; de check gebeurt in de Animus.
export async function deletePerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_PERSON;
    const name = String(formData.get("name") ?? "");
    if (!(await getAnimus().deletePerson(id, name))) {
      return "De naam klopt niet, of dit is de eigenaar (of de Persoon bestaat niet meer). Er is niets verwijderd.";
    }
  });
}

// Stemontwerp (ElevenLabs). De API-key blijft server-side in process.env.
const elevenKey = () => process.env.ELEVENLABS_API_KEY ?? "";

export type DesignState = ActionState & { previews?: DesignPreview[] };

export async function designVoiceAction(_prev: DesignState, formData: FormData): Promise<DesignState> {
  try {
    const description = String(formData.get("description") ?? "");
    const invalid = voiceInputError({ description });
    if (invalid) return { error: invalid };
    const previews = await designVoice(fetch, elevenKey(), description, String(formData.get("previewText") ?? ""));
    return previews.length ? { previews } : { error: "ElevenLabs gaf geen previews terug." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function applyDesignedVoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const description = String(formData.get("description") ?? "").trim();
    const name = String(formData.get("name") ?? "");
    const generatedVoiceId = String(formData.get("generatedVoiceId") ?? "");
    const invalid = voiceInputError({ name, description, generatedVoiceId });
    if (invalid) return invalid;
    const voice = await saveDesignedVoice(fetch, elevenKey(), { name, description, generatedVoiceId });
    if (!(await getAnimus().setVoiceProfile(id, { voice, description: description || null }))) return DYNIMO_GONE;
  });
}

export async function cloneVoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const name = String(formData.get("name") ?? "");
    const invalid = voiceInputError({ name });
    if (invalid) return invalid;
    const voice = await cloneVoice(fetch, elevenKey(), { name, files, consent: formData.get("consent") === "on" });
    if (!(await getAnimus().setVoiceProfile(id, { voice, description: null }))) return DYNIMO_GONE;
  });
}

// Modelwissel (#132): globaal Type2-model; een leeg veld = terug naar de standaard uit .env. Geldt vanaf de volgende beurt.
export async function setType2Models(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const field = (name: string) => String(formData.get(name) ?? "").trim() || null;
    await getAnimus().setType2Models({ light: field("light"), heavy: field("heavy") });
  });
}

export async function resetType2Models(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return run(() => getAnimus().setType2Models({ light: null, heavy: null }));
}
