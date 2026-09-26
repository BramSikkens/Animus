import type { KenmerkenMessage } from "@animus/brain/kenmerken";
import { AXES, AXIS_POLES, type Axis } from "@animus/brain/personality";

export type AsBalk = { axis: Axis; links: string; rechts: string; value: number };
export type KenmerkenPanel = {
  label: string;
  assen: AsBalk[];
  verstand: number;
  kernkarakter: string;
  /** Klaar om te tonen, bv. "Vertrouwdheid: Bram" of "Vertrouwdheid: onbekend" (reviewfix #105). */
  vertrouwdheidLabel: string;
  /** Balkwaarde 0–1, of `null` bij een onbekende Gesprekspartner (dan geen balkje). */
  vertrouwdheidWaarde: number | null;
};

/** Opmaak voor het kenmerkenpaneel (#105): archetype + basisemotie als label, assen/Verstand met poollabels (null → midden). */
export function kenmerkenPanel(message: KenmerkenMessage): KenmerkenPanel {
  const vertrouwdheid = message.vertrouwdheid;
  return {
    label: message.archetype ? `${message.archetype} · ${message.basisemotie}` : message.basisemotie,
    assen: AXES.map((axis) => ({ axis, links: AXIS_POLES[axis][0], rechts: AXIS_POLES[axis][1], value: message.assen[axis] ?? 0.5 })),
    verstand: message.verstand ?? 0.5,
    kernkarakter: message.kernkarakter,
    vertrouwdheidLabel: `Vertrouwdheid: ${"onbekend" in vertrouwdheid ? "onbekend" : vertrouwdheid.naam}`,
    vertrouwdheidWaarde: "onbekend" in vertrouwdheid ? null : vertrouwdheid.waarde,
  };
}
