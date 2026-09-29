// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
import { SOUND_KINDS, type SoundKind } from "@animus/core/sound";

export function isSoundKind(value: unknown): value is SoundKind {
  return typeof value === "string" && (SOUND_KINDS as readonly string[]).includes(value);
}

/** Bericht op het LiveKit data channel, van agent naar gezichtje. */
export type SoundMessage = { kind: SoundKind };
export const SOUND_TOPIC = "sound";
