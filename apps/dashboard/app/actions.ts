"use server";

import { revalidatePath } from "next/cache";
import { parseArchetypeId } from "@animus/brain/archetypes";
import { isEmotion } from "@animus/brain/emotion";
import { parseMoodValues } from "@animus/brain/mood";
import { parseFamiliarity } from "@animus/brain/familiarity";
import { parseAxes } from "@animus/brain/personality";
import { parseVerstand } from "@animus/brain/verstand";
import { adoptVoice, cloneVoice, designVoice, saveDesignedVoice, type DesignPreview } from "@animus/brain/voice-design";
import { parseVoice, speechProvider, voiceInputError } from "@animus/brain/voice";
import { unusableVoiceError } from "@animus/brain/voice-catalog";
import { getBrain } from "../lib/brain";
import { getCatalog } from "../lib/voice-catalog";

export type ActionState = { error?: string };

// Een string uit `work` is een foutmelding; gooit `work`, dan wordt de fout leesbaar getoond i.p.v. te crashen.
async function run(work: () => Promise<string | void>, path = "/"): Promise<ActionState> {
  try {
    const error = await work();
    if (error) return { error };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath(path);
  return {};
}

function parseId(formData: FormData): number | null {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

const INVALID_ID = "Ongeldige Dynimo.";

export async function bringToLife(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return run(async () => {
    await getBrain().bringToLife();
  });
}

export async function wake(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    if (!(await getBrain().wake(id))) return "Deze Dynimo bestaat niet meer.";
  });
}

export async function sleep(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return run(() => getBrain().sleep());
}

export async function kill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    if (!(await getBrain().kill(id, String(formData.get("name") ?? "")))) {
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
    if (!(await getBrain().forceMood(id, emotion, intensity))) return DYNIMO_GONE;
  });
}

export async function setMood(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const values = parseMoodValues((name) => formData.get(name));
    if (!values) return "Ongeldige emotiewaarden.";
    if (!(await getBrain().setMood(id, values))) return DYNIMO_GONE;
  });
}

export async function setAxes(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const axes = parseAxes((name) => formData.get(name));
    if (!axes) return "Ongeldige persoonlijkheidsassen.";
    if (!(await getBrain().setAxes(id, axes))) return DYNIMO_GONE;
  });
}

export async function setFamiliarity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const familiarity = parseFamiliarity((name) => formData.get(name));
    if (familiarity === null) return "Ongeldige vertrouwdheid.";
    if (!(await getBrain().setFamiliarity(id, familiarity))) return DYNIMO_GONE;
  });
}

export async function setVerstand(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const verstand = parseVerstand((name) => formData.get(name));
    if (verstand === null) return "Ongeldig Verstand.";
    if (!(await getBrain().setVerstand(id, verstand))) return DYNIMO_GONE;
  });
}

export async function setArchetype(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const archetype = parseArchetypeId(formData.get("archetype"));
    if (!archetype) return "Ongeldig archetype.";
    if (!(await getBrain().setArchetype(id, archetype))) return DYNIMO_GONE;
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
    if (!(await getBrain().setVoiceProfile(id, { voice, description }))) return DYNIMO_GONE;
  });
}

export async function addMemory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_ID;
    const text = String(formData.get("text") ?? "").trim();
    if (!text) return "Vul een tekst in.";
    if (!(await getBrain().addMemory(id, text))) return DYNIMO_GONE;
  });
}

export async function removeMemory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    const memoryId = Number(formData.get("memoryId"));
    if (id === null || !Number.isInteger(memoryId)) return "Ongeldige Herinnering.";
    if (!(await getBrain().removeMemory(id, memoryId))) return "Deze Herinnering bestaat niet (meer).";
  });
}

// Personen (#95): server actions dun bovenop de brain-functies.
const INVALID_PERSON = "Ongeldige Persoon.";
const PERSON_GONE = "Deze Persoon bestaat niet (meer).";

export async function renamePerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_PERSON;
    const name = String(formData.get("name") ?? "");
    if (!(await getBrain().renamePerson(id, name))) return "Ongeldige naam (of de Persoon bestaat niet meer).";
  }, "/personen");
}

// Bevestiging zoals bij verwijderen: de exacte naam van de Persoon die verdwijnt (removeId), vóór het samenvoegen.
export async function mergePersons(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const keepId = parseId(formData);
    const removeId = Number(formData.get("removeId"));
    if (keepId === null || !Number.isInteger(removeId) || removeId <= 0) return INVALID_PERSON;
    const remove = (await getBrain().listPersons()).find((person) => person.id === removeId);
    if (!remove || remove.name !== String(formData.get("name") ?? "")) {
      return "De naam klopt niet (of de Persoon bestaat niet meer). Er is niets samengevoegd.";
    }
    if (!(await getBrain().mergePersons(keepId, removeId))) return "Kan deze twee Personen niet samenvoegen.";
  }, "/personen");
}

export async function relearnPerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_PERSON;
    if (!(await getBrain().relearnPerson(id))) return PERSON_GONE;
  }, "/personen");
}

// Zoals kill(): de exacte naam ter bevestiging; de check gebeurt in de brain.
export async function deletePerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = parseId(formData);
    if (id === null) return INVALID_PERSON;
    const name = String(formData.get("name") ?? "");
    if (!(await getBrain().deletePerson(id, name))) {
      return "De naam klopt niet, of dit is de eigenaar (of de Persoon bestaat niet meer). Er is niets verwijderd.";
    }
  }, "/personen");
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
    if (!(await getBrain().setVoiceProfile(id, { voice, description: description || null }))) return DYNIMO_GONE;
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
    if (!(await getBrain().setVoiceProfile(id, { voice, description: null }))) return DYNIMO_GONE;
  });
}
