import { isWaarneming } from "@animus/protocol/perception";

// Hergebruikt de trust-boundary-regex van isWaarneming (OBJECT_PATTERN) i.p.v. die te dupliceren.
const isValidLabel = (label: string): boolean => isWaarneming({ soort: "nieuw-object", object: label });

/**
 * Pure objecttracker (#87): ruwe COCO-detecties per frame → klassen die dit frame NIEUW gemeld worden.
 * `person` telt nooit mee. Enkel detecties met score >= minScore tellen. Een klasse is pas stabiel na
 * `stableMs` ONONDERBROKEN in beeld (een gemist frame reset de teller). De warmup-periode begint bij het
 * eerste `update`-frame: klassen die daarbinnen stabiel worden, zijn "al gezien bij het wakker worden" en
 * worden stil gemarkeerd (geen melding). Een eenmaal geziene klasse wordt nooit opnieuw gemeld.
 */
export function createObjectTracker({ minScore = 0.6, stableMs = 1000, warmupMs }: { minScore?: number; stableMs?: number; warmupMs: number }) {
  let firstFrameT: number | undefined;
  const seen = new Set<string>();
  const streaks = new Map<string, number>(); // klasse -> sinds welk tijdstip ononderbroken in beeld

  return {
    update(detections: { category: string; score: number }[], t: number): string[] {
      if (firstFrameT === undefined) firstFrameT = t;

      const current = new Set(
        detections
          .filter((d) => d.category !== "person" && d.score >= minScore)
          .map((d) => d.category.toLowerCase())
          .filter(isValidLabel),
      );

      for (const klasse of streaks.keys()) {
        if (!current.has(klasse)) streaks.delete(klasse);
      }
      for (const klasse of current) {
        if (!streaks.has(klasse)) streaks.set(klasse, t);
      }

      const nieuw: string[] = [];
      for (const [klasse, since] of streaks) {
        if (seen.has(klasse) || t - since < stableMs) continue;
        seen.add(klasse);
        if (t - firstFrameT >= warmupMs) nieuw.push(klasse);
      }
      return nieuw;
    },
  };
}
