import type { Dynimo } from "@animus/core";
import type { EmotionMessage } from "@animus/core/emotion";
import { baseEmotionOf, FALLBACK_BASE, faceIntensity } from "@animus/core/mood";
import type { KenmerkenMessage, Vertrouwdheid } from "@animus/protocol/kenmerken";

/** Bericht voor het gezichtje: de Stemming, of bij slapend een reset (geen `values`, dus geen balken). */
export function emotionMessageFor(mood: EmotionMessage | null): Omit<EmotionMessage, "values"> & Partial<Pick<EmotionMessage, "values">> {
  return mood ?? { emotion: FALLBACK_BASE, intensity: 0 };
}

/** Het gezicht volgt de expressiviteit-as: alleen de intensiteit wordt geschaald; emotion en values (de ware waarden voor de balkjes) blijven. */
export function withFaceExpressiveness<M extends { intensity: number }>(message: M, expressiveness: number): M {
  return { ...message, intensity: faceIntensity(message.intensity, expressiveness) };
}

type KenmerkenRow = Pick<
  Dynimo,
  "archetype" | "baseEmotion" | "coreCharacter" | "axisIe" | "axisSn" | "axisTf" | "axisJp" | "axisReactivity" | "axisExpressiveness" | "verstand"
>;

/** Bericht voor het gezichtje: de kenmerken van de wakkere Dynimo; `null` (niemand wakker) laat het paneel verdwijnen. */
export function kenmerkenMessageFor(row: KenmerkenRow | null, vertrouwdheid: Vertrouwdheid): KenmerkenMessage | null {
  if (!row) return null;
  return {
    archetype: row.archetype,
    basisemotie: baseEmotionOf(row) ?? FALLBACK_BASE,
    assen: { ie: row.axisIe, sn: row.axisSn, tf: row.axisTf, jp: row.axisJp, reactivity: row.axisReactivity, expressiveness: row.axisExpressiveness },
    verstand: row.verstand,
    kernkarakter: row.coreCharacter,
    vertrouwdheid,
  };
}

/** Publiceert periodiek de toestand opnieuw, zodat de balken meelopen met het uitdoven van de Stemming. */
export function createStateRepublisher(options: { intervalMs: number; isActive: () => boolean; publish: () => void }) {
  let timer: NodeJS.Timeout | undefined;
  return {
    start(): void {
      timer ??= setInterval(() => {
        if (options.isActive()) options.publish();
      }, options.intervalMs);
    },
    dispose(): void {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
