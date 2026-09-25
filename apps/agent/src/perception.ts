import type { Aanleiding, Waarneming } from "@animus/brain/perception";

export const DEFAULT_RETURN_AFTER_MINUTES = 10;

/** Parseert RETURN_AFTER_MINUTES (drempel voor de aanleiding "terug"); ongeldig geeft een waarschuwing. */
export function parseReturnAfterMinutes(value: string | undefined): { ms: number; warning?: string } {
  const fallback = DEFAULT_RETURN_AFTER_MINUTES * 60_000;
  if (value === undefined || value.trim() === "") return { ms: fallback };
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ms: fallback, warning: `RETURN_AFTER_MINUTES="${value}" is ongeldig; default ${DEFAULT_RETURN_AFTER_MINUTES} minuten.` };
  }
  return { ms: minutes * 60_000 };
}

/**
 * Pure perceptiemodule (klok geïnjecteerd): houdt aanwezigheid bij op basis van Waarnemingen van de face-app.
 * "onbekend" (voordat er een Waarneming binnenkwam) telt als aanwezig, zodat het initiatief niet stilvalt
 * zonder camera of zonder face-app.
 */
export function createPerception({ now, returnAfterMs }: { now: () => number; returnAfterMs: number }) {
  let presentState: "onbekend" | "aanwezig" | "afwezig" = "onbekend";
  let absentSince: number | undefined;

  return {
    onWaarneming(w: Waarneming): Aanleiding | null {
      if (w.soort === "afwezig") {
        if (presentState !== "afwezig") absentSince = now();
        presentState = "afwezig";
        return null;
      }
      if (w.soort === "aanwezig") {
        const wasLongAbsent = presentState === "afwezig" && absentSince !== undefined && now() - absentSince > returnAfterMs;
        presentState = "aanwezig";
        absentSince = undefined;
        return wasLongAbsent ? { soort: "terug" } : null;
      }
      return null;
    },
    isPresent(): boolean {
      return presentState !== "afwezig";
    },
    reset(): void {
      presentState = "onbekend";
    },
  };
}
