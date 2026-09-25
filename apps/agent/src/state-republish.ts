import type { EmotionMessage } from "@animus/brain/emotion";
import { FALLBACK_BASE, faceIntensity } from "@animus/brain/mood";

/** Bericht voor het gezichtje: de Stemming, of bij slapend een reset (geen `values`, dus geen balken). */
export function emotionMessageFor(mood: EmotionMessage | null): Omit<EmotionMessage, "values"> & Partial<Pick<EmotionMessage, "values">> {
  return mood ?? { emotion: FALLBACK_BASE, intensity: 0 };
}

/** Het gezicht volgt de expressiviteit-as: alleen de intensiteit wordt geschaald; emotion en values (de ware waarden voor de balkjes) blijven. */
export function withFaceExpressiveness<M extends { intensity: number }>(message: M, expressiveness: number): M {
  return { ...message, intensity: faceIntensity(message.intensity, expressiveness) };
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
