// Browser-veilig: geen node-imports. Pure beslisfunctie: emotievector + assen + rng -> gedrag van deze beurt.
import { strength, type MoodValues } from "./mood.js";
import type { Axes } from "./personality.js";

export type Behavior = "normaal" | "kort" | "lang" | "negeren";

/** Boos vanaf deze sterkte (0-1) én dominant: kans op negeren. */
export const BOOS_THRESHOLD = 0.7;
/** Kans op negeren bij boos, vóór schaling met persoonlijkheid. */
export const NEGEREN_CHANCE = 0.6;

/** Extra kans op 'kort' bij boos (na de negeerkans), vóór schaling. */
export const BOOS_KORT_CHANCE = 0.3;

/** Zeer blij vanaf deze sterkte (0-1) én dominant: kans op lange antwoorden en meer eigen initiatief. */
export const BLIJ_THRESHOLD = 0.7;
export const LANG_CHANCE = 0.7;
/** Bang of verveeld vanaf deze sterkte (dominant): kans op korte antwoorden. */
export const KORT_THRESHOLD = 0.6;
export const KORT_CHANCE = 0.6;
/** Bij zeer blij wordt het initiatief-interval gedeeld door deze factor (vóór schaling met expressiviteit). */
export const BLIJ_INITIATIVE_BOOST = 2;

/** Schaal 0..1: reactiviteit, gedempt door warmte (T↔F: 1 = F verlaagt de kans tot een kwart). */
const angerScale = (axes: Axes) => axes.reactivity * (1 - 0.75 * axes.tf);

const dominant = (values: MoodValues) => Object.entries(values).reduce((a, b) => (b[1] > a[1] ? b : a))[0];

/** `vorigeGenegeerd`: de vorige beurt werd genegeerd; negeren wordt dan 'kort', zodat de stilte nooit permanent is. */
export function decideBehavior({
  values,
  axes,
  rng,
  vorigeGenegeerd = false,
}: {
  values: MoodValues;
  axes: Axes;
  rng: () => number;
  vorigeGenegeerd?: boolean;
}): Behavior {
  if (strength(values.boos) >= BOOS_THRESHOLD && dominant(values) === "boos") {
    const scale = angerScale(axes);
    const roll = rng();
    if (roll < NEGEREN_CHANCE * scale) return vorigeGenegeerd ? "kort" : "negeren";
    if (roll < (NEGEREN_CHANCE + BOOS_KORT_CHANCE) * scale) return "kort";
  }
  const top = dominant(values);
  const emotive = (axes.reactivity + axes.expressiveness) / 2;
  if (top === "blij" && strength(values.blij) >= BLIJ_THRESHOLD && rng() < LANG_CHANCE * emotive) return "lang";
  if ((top === "bang" || top === "verveeld") && strength(values[top]) >= KORT_THRESHOLD && rng() < KORT_CHANCE * axes.reactivity) return "kort";
  return "normaal";
}

/** Factor (>= 1) waarmee het initiatief-interval korter wordt: zeer blij praat vaker uit zichzelf, geschaald door expressiviteit. */
export function initiativeFactor(values: MoodValues, axes: Axes): number {
  return dominant(values) === "blij" && strength(values.blij) >= BLIJ_THRESHOLD ? 1 + (BLIJ_INITIATIVE_BOOST - 1) * axes.expressiveness : 1;
}
