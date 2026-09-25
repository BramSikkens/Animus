/**
 * Smalle interface voor stemherkenning (ADR-0020, #92): `identify` per uiting, `enroll` bouwt een profiel op tot
 * "klaar". Achter deze interface zit nu Eagle (eagle-speaker-id.ts); sherpa-onnx kan haar vervangen.
 */
export type SpeakerId = {
  identify(pcm: Int16Array): { personId: number; score: number } | null;
  enroll(personId: number, pcm: Int16Array): Promise<"bezig" | "klaar">;
  reload(): Promise<void>;
  dispose(): void;
};

/**
 * Pure kiezer: per Persoon het maximum over zijn profielen (hoogstens 5), en van die Personen de beste boven
 * `threshold`. `scoresPerProfile`/`profilePersonIds` hebben dezelfde volgorde en lengte (één score per profiel).
 */
export function bestMatch({
  scoresPerProfile,
  profilePersonIds,
  threshold,
}: {
  scoresPerProfile: number[];
  profilePersonIds: number[];
  threshold: number;
}): { personId: number; score: number } | null {
  const bestPerPerson = new Map<number, number>();
  for (const [index, score] of scoresPerProfile.entries()) {
    const personId = profilePersonIds[index]!;
    bestPerPerson.set(personId, Math.max(bestPerPerson.get(personId) ?? -Infinity, score));
  }
  let best: { personId: number; score: number } | null = null;
  for (const [personId, score] of bestPerPerson) {
    if (score >= threshold && (!best || score > best.score)) best = { personId, score };
  }
  return best;
}

export const DEFAULT_SPEAKER_MATCH_THRESHOLD = 0.5;

/** Parseert SPEAKER_MATCH_THRESHOLD (0–1); ongeldig geeft een waarschuwing (patroon: parseInitiativeMinutes). */
export function parseSpeakerMatchThreshold(value: string | undefined): { threshold: number; warning?: string } {
  if (value === undefined || value.trim() === "") return { threshold: DEFAULT_SPEAKER_MATCH_THRESHOLD };
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return { threshold: DEFAULT_SPEAKER_MATCH_THRESHOLD, warning: `SPEAKER_MATCH_THRESHOLD="${value}" is ongeldig; default ${DEFAULT_SPEAKER_MATCH_THRESHOLD}.` };
  }
  return { threshold };
}
