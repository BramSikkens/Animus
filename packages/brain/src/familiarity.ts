// Browser-veilig, puur. Vertrouwdheid (CONTEXT.md): hoe vertrouwd de relatie met de Gesprekspartner is, 0..1.
import type { Axes } from "./personality.js";

export type FamiliarityEvent = "beurt" | "positief" | "genegeerd" | "langeStilte";

/** Groei per beurt bij snelheid 1, als aandeel van de resterende ruimte (1 − current). */
export const FAMILIARITY_TURN_RATE = 0.01;

/** Groei bij een positieve emotie / compliment (blij-delta), zelfde schaal als hierboven. */
export const FAMILIARITY_POSITIVE_RATE = 0.03;
/** Daling (absoluut) bij een genegeerde beurt en bij een Reflectie na lange stilte. */
export const FAMILIARITY_IGNORED_DROP = 0.02;
export const FAMILIARITY_SILENCE_DROP = 0.04;
/** Dalende events brengen Vertrouwdheid nooit onder deze ondergrens (een lagere handmatige waarde blijft staan). */
export const FAMILIARITY_FLOOR = 0.05;

/** Persoonlijkheid schaalt de groeisnelheid: 0.5 (T/gesloten) … 1.5 (F/expressief); bij tf = expressiviteit = 0.5 is dat 1. */
const speed = (axes: Pick<Axes, "tf" | "expressiveness">) => 0.5 + 0.5 * axes.tf + 0.5 * axes.expressiveness;

export function updateFamiliarity({
  current,
  event,
  axes,
}: {
  current: number;
  event: FamiliarityEvent;
  axes: Pick<Axes, "tf" | "expressiveness">;
}): number {
  if (event === "genegeerd" || event === "langeStilte") {
    const drop = event === "genegeerd" ? FAMILIARITY_IGNORED_DROP : FAMILIARITY_SILENCE_DROP;
    return Math.max(current - drop, Math.min(current, FAMILIARITY_FLOOR));
  }
  const rate = event === "positief" ? FAMILIARITY_POSITIVE_RATE : FAMILIARITY_TURN_RATE;
  return current + (1 - current) * rate * speed(axes);
}

export type FamiliarityBand = "afstandelijk" | "vriendelijk" | "vertrouwd" | "intiem";

const STYLES: Record<FamiliarityBand, string> = {
  afstandelijk:
    "Je kent de Gesprekspartner nog nauwelijks: wees beleefd en enigszins formeel, hou wat afstand en gebruik geen bijnamen. Spreek de ander aan met 'u' als dat bij je archetype of karakter past, anders met 'je'; maak geen persoonlijke grapjes.",
  vriendelijk:
    "Je leert de Gesprekspartner kennen: wees vriendelijk en open, spreek de ander aan met 'je', maar hou het nog netjes: geen bijnamen en geen plagerijen.",
  vertrouwd:
    "Je kent de Gesprekspartner goed: spreek de ander aan met 'je', maak gerust grapjes en verwijs waar het past naar eerdere gesprekken.",
  intiem:
    "De Gesprekspartner is je dierbaar: spreek informeel en persoonlijk, geef de ander gerust bijnamen, plaag hem of haar liefdevol en durf persoonlijke dingen te zeggen en te vragen.",
};

/** Bandgrenzen (ondergrens per band); een nieuwe Dynimo (0.2) start afstandelijk. */
const BAND_FLOORS: readonly [FamiliarityBand, number][] = [["intiem", 0.8], ["vertrouwd", 0.55], ["vriendelijk", 0.3]];

/** De toon-band bij een Vertrouwdheid en de bijbehorende Nederlandse Type2-instructie. */
export function familiarityStyle(familiarity: number): { band: FamiliarityBand; instruction: string } {
  const band = BAND_FLOORS.find(([, floor]) => familiarity >= floor)?.[0] ?? "afstandelijk";
  return { band, instruction: STYLES[band] };
}

/** Dashboard-formulier: veld `familiarity` (0–1, geclampt); null als het ontbreekt of geen getal is. */
export function parseFamiliarity(field: (name: string) => unknown): number | null {
  const raw = field("familiarity");
  if (typeof raw !== "string" || raw.trim() === "" || Number.isNaN(Number(raw))) return null;
  return Math.min(1, Math.max(0, Number(raw)));
}
