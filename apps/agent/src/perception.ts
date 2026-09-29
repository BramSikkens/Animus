import type { Aanleiding } from "@animus/brain/perception";
import type { Waarneming } from "@animus/protocol/perception";

export const DEFAULT_RETURN_AFTER_MINUTES = 10;
export const DEFAULT_LOOK_COOLDOWN_MINUTES = 3;

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

/** Parseert SPONTANEOUS_LOOK_COOLDOWN_MINUTES (cooldown voor de aanleiding "nieuw-object"); ongeldig geeft een waarschuwing. */
export function parseLookCooldownMinutes(value: string | undefined): { ms: number; warning?: string } {
  const fallback = DEFAULT_LOOK_COOLDOWN_MINUTES * 60_000;
  if (value === undefined || value.trim() === "") return { ms: fallback };
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ms: fallback, warning: `SPONTANEOUS_LOOK_COOLDOWN_MINUTES="${value}" is ongeldig; default ${DEFAULT_LOOK_COOLDOWN_MINUTES} minuten.` };
  }
  return { ms: minutes * 60_000 };
}

/**
 * Pure perceptiemodule (klok geïnjecteerd): houdt aanwezigheid bij op basis van Waarnemingen van de face-app.
 * "onbekend" (voordat er een Waarneming binnenkwam) telt als aanwezig, zodat het initiatief niet stilvalt
 * zonder camera of zonder face-app.
 */
export function createPerception({ now, returnAfterMs, lookCooldownMs }: { now: () => number; returnAfterMs: number; lookCooldownMs: number }) {
  let presentState: "onbekend" | "aanwezig" | "afwezig" = "onbekend";
  let absentSince: number | undefined;
  let lastLookAt: number | undefined;

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
      // gezicht (#93): geen presence-Waarneming; de agent routeert die apart naar recognizeFaces/faces.ts.
      if (w.soort === "gezicht") return null;
      // nieuw-object: enkel buiten de cooldown en met iemand aanwezig.
      if (presentState === "afwezig") return null;
      if (lastLookAt !== undefined && now() - lastLookAt < lookCooldownMs) return null;
      // ponytail: de cooldown start hier bij het uitlokken (niet pas als Type1 "ja" zegt bij considerInitiative).
      // Strenger dan strikt nodig — een "nee" van Type1 blokkeert dan ook de volgende cooldown — maar garandeert
      // zo hoogstens één spontane Kijk per cooldown, zonder de uitkomst van de (async) initiatiefcheck af te wachten.
      lastLookAt = now();
      return { soort: "nieuw-object", object: w.object };
    },
    isPresent(): boolean {
      return presentState !== "afwezig";
    },
    // De cooldown wist niet mee: een reset (Dynimo-wissel) mag geen extra spontane Kijk-beurten opleveren.
    reset(): void {
      presentState = "onbekend";
      absentSince = undefined;
    },
  };
}
