export const DEFAULT_SILENCE_MINUTES = 30;
/** setTimeout kapt op 2^31-1 ms; daarboven vuurt hij vrijwel meteen. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** Parseert REFLECT_SILENCE_MINUTES (fractioneel toegestaan); ongeldig of te groot geeft een waarschuwing. */
export function parseSilenceMinutes(value: string | undefined): { ms: number; warning?: string } {
  const fallback = DEFAULT_SILENCE_MINUTES * 60_000;
  if (value === undefined || value.trim() === "") return { ms: fallback };
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ms: fallback, warning: `REFLECT_SILENCE_MINUTES="${value}" is ongeldig; default ${DEFAULT_SILENCE_MINUTES} minuten.` };
  }
  const ms = minutes * 60_000;
  if (ms > MAX_TIMER_MS) {
    return { ms: MAX_TIMER_MS, warning: `REFLECT_SILENCE_MINUTES="${value}" is te groot voor een timer; begrensd op ${Math.floor(MAX_TIMER_MS / 60_000)} minuten.` };
  }
  return { ms };
}

/**
 * Stilte-timer voor de Reflectie bij stilte (#28). Eénmalig per stilte: na afvuren start hij pas weer bij een
 * nieuwe `arm()` of `reset()` (nieuwe uiting, Dynimo-wissel of wakker worden).
 */
export function createSilenceTimer(options: { thresholdMs: number; onSilence: () => void }) {
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;

  function start(): void {
    if (disposed) return;
    timer = setTimeout(() => {
      timer = undefined;
      options.onSilence();
    }, options.thresholdMs);
  }

  return {
    /** Start de timer als hij nog niet loopt; een lopende timer blijft ongemoeid. */
    arm(): void {
      if (!timer) start();
    },
    /** Herstart de drempel (bv. bij een nieuwe uiting). */
    reset(): void {
      clearTimeout(timer);
      timer = undefined;
      start();
    },
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
