import { getArchetype } from "@animus/core/archetypes";
import type { KenmerkenMessage } from "@animus/protocol/kenmerken";
import { AXES, AXIS_POLES, type Axis } from "@animus/core/personality";

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
  // Archetype-naam i.p.v. het id (#111); onbekend id (bv. verouderd) valt terug op het ruwe id.
  const archetypeNaam = message.archetype ? (getArchetype(message.archetype)?.name ?? message.archetype) : null;
  return {
    label: archetypeNaam ? `${archetypeNaam} · ${message.basisemotie}` : message.basisemotie,
    assen: AXES.map((axis) => ({ axis, links: AXIS_POLES[axis][0], rechts: AXIS_POLES[axis][1], value: message.assen[axis] ?? 0.5 })),
    verstand: message.verstand ?? 0.5,
    kernkarakter: message.kernkarakter,
    vertrouwdheidLabel: `Vertrouwdheid: ${"onbekend" in vertrouwdheid ? "onbekend" : vertrouwdheid.naam}`,
    vertrouwdheidWaarde: "onbekend" in vertrouwdheid ? null : vertrouwdheid.waarde,
  };
}
