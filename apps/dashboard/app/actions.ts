"use server";

import { revalidatePath } from "next/cache";
import { parseArchetypeId } from "@animus/brain/archetypes";
import { isEmotion } from "@animus/brain/emotion";
import { parseMoodValues } from "@animus/brain/mood";
import { parseAxes } from "@animus/brain/personality";
import { parseVoice, speechProvider } from "@animus/brain/voice";
import { getBrain } from "../lib/brain";

export type ActionState = { error?: string };

// Een string uit `work` is een foutmelding; gooit `work`, dan wordt de fout leesbaar getoond i.p.v. te crashen.
async function run(work: () => Promise<string | void>): Promise<ActionState> {
  try {
    const error = await work();
    if (error) return { error };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/");
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
    if (!(await getBrain().setVoice(id, parsed.voice))) return DYNIMO_GONE;
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
