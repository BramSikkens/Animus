// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
import { type Axis, AXES } from "@animus/core/personality";
import { isEmotion, type Emotion } from "@animus/core/emotion";

export const KENMERKEN_TOPIC = "kenmerken";

/** Vertrouwdheid met de huidige Gesprekspartner: onbekend, of een bekende Persoon met naam en waarde. */
export type Vertrouwdheid = { naam: string; waarde: number } | { onbekend: true };

/** Bericht op het LiveKit data channel, van agent naar gezichtje. `null` (niemand wakker): het paneel verdwijnt. */
export type KenmerkenMessage = {
  archetype: string | null;
  basisemotie: Emotion;
  /** Elke as 0–1; `null` (nog niet ingesteld) toont in het gezichtje als midden. */
  assen: Record<Axis, number | null>;
  /** 0–1; `null` toont als midden. */
  verstand: number | null;
  kernkarakter: string;
  vertrouwdheid: Vertrouwdheid;
};

function isVertrouwdheid(value: unknown): value is Vertrouwdheid {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.onbekend === true) return true;
  return typeof v.naam === "string" && typeof v.waarde === "number";
}

function isAssen(value: unknown): value is Record<Axis, number | null> {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return AXES.every((axis) => typeof v[axis] === "number" || v[axis] === null);
}

export function isKenmerkenMessage(value: unknown): value is KenmerkenMessage {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.archetype === "string" || v.archetype === null) &&
    isEmotion(v.basisemotie) &&
    isAssen(v.assen) &&
    (typeof v.verstand === "number" || v.verstand === null) &&
    typeof v.kernkarakter === "string" &&
    isVertrouwdheid(v.vertrouwdheid)
  );
}
