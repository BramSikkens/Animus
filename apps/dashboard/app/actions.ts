"use server";

import { revalidatePath } from "next/cache";
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
