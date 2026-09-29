// Browser-veilig, puur. Kiest een Spontane herinnering (CONTEXT.md): een oude, vormende Herinnering waar de Dynimo
// zelf op terugkomt ('Je zei vorige week dat je ziek was, ben je beter?').
import type { Axes } from "./personality.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Alleen Herinneringen ouder dan dit. */
export const SPONTANEOUS_MIN_AGE_MS = DAY_MS;
/** Alleen Herinneringen met minstens deze Indruk. */
export const SPONTANEOUS_MIN_IMPRESSION = 0.5;
/** Zo lang na 'laatst aangehaald' komt dezelfde Herinnering niet terug. */
export const SPONTANEOUS_COOLDOWN_MS = 7 * DAY_MS;
/** Vanaf deze ouderdom weegt de ouderdomsfactor voluit (1); jonger telt minder (min. 0.5). */
const FULL_AGE_MS = 7 * DAY_MS;
/** Basiskans bij een initiatief-moment (vóór persoonlijkheid). */
export const SPONTANEOUS_INITIATIVE_CHANCE = 0.5;
/** Basiskans in een normale beurt: heel zelden. */
export const SPONTANEOUS_TURN_CHANCE = 0.03;

export type SpontaneousCandidate = { id: number; createdAt: Date; impression: number; lastRecalledAt: Date | null; text: string };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Kans op aanhalen: basis x warmer (F, tf=1) meer x expressiever meer, geclampt op 0..1. */
export function spontaneousChance(axes: Axes, base = SPONTANEOUS_INITIATIVE_CHANCE): number {
  return clamp01(base * (0.5 + 0.5 * clamp01(axes.tf)) * (0.5 + clamp01(axes.expressiveness)));
}

/** De aan te halen Herinnering, of null. Eerste rng-worp = de kans, tweede = de gewogen keuze (Indruk x ouderdom). */
export function pickSpontaneousMemory({ memories, now, axes, rng, minAgeMs = SPONTANEOUS_MIN_AGE_MS, cooldownMs = SPONTANEOUS_COOLDOWN_MS, baseChance, chanceRolled = false }: { memories: SpontaneousCandidate[]; now: Date; axes: Axes; rng: () => number; minAgeMs?: number; cooldownMs?: number; baseChance?: number; /** De kansworp is al gedaan (zie spontaneousChance); sla hem hier over. */ chanceRolled?: boolean }): SpontaneousCandidate | null {
  const nowMs = now.getTime();
  const weighted = memories
    .filter((m) => nowMs - m.createdAt.getTime() >= minAgeMs && m.impression >= SPONTANEOUS_MIN_IMPRESSION && (!m.lastRecalledAt || nowMs - m.lastRecalledAt.getTime() >= cooldownMs))
    .map((m) => ({ m, weight: m.impression * (0.5 + 0.5 * Math.min(1, (nowMs - m.createdAt.getTime()) / FULL_AGE_MS)) }));
  if (weighted.length === 0 || (!chanceRolled && rng() >= spontaneousChance(axes, baseChance))) return null;
  let target = rng() * weighted.reduce((sum, w) => sum + w.weight, 0);
  for (const { m, weight } of weighted) {
    target -= weight;
    if (target < 0) return m;
  }
  return weighted.at(-1)!.m;
}
