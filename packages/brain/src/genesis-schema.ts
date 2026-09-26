import { z } from "zod";
import { drives } from "@animus/db/schema";
import { DRIVE_KINDS } from "./drives.js";

export const axesSchema = z.object({
  ie: z.number().min(0).max(1),
  sn: z.number().min(0).max(1),
  tf: z.number().min(0).max(1),
  jp: z.number().min(0).max(1),
});

const driveItem = z.object({ text: z.string().min(1) });

// Per soort 1 tot 2 Drijfveren.
export const drivesSchema = z.object({
  wens: z.array(driveItem).min(1).max(2),
  doel: z.array(driveItem).min(1).max(2),
  toekomstdroom: z.array(driveItem).min(1).max(2),
  ergernis: z.array(driveItem).min(1).max(2),
});
export type DrivesOutput = z.infer<typeof drivesSchema>;

export function driveRowsFor(dynimoId: number, output: DrivesOutput, at: Date): (typeof drives.$inferInsert)[] {
  return DRIVE_KINDS.flatMap((kind) =>
    output[kind].map((item) => ({
      dynimoId,
      kind,
      text: item.text,
      status: kind === "doel" ? "actief" : null,
      createdAt: at,
      updatedAt: at,
    })),
  );
}

// archetype staat eerst: structured output volgt de sleutelvolgorde, zodat naam/karakter/drijfveren bij de keuze passen.
export const genesisSchema = z.object({
  archetype: z.string(),
  name: z.string().min(1),
  coreCharacter: z.string().min(1),
  birthStory: z.string().min(1),
  drives: drivesSchema,
  voiceDescription: z.string(),
  voiceSearchTerms: z.array(z.string()),
});
