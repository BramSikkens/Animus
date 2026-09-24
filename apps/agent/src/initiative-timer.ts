/** Hoe vaak initiatief voorkomt hangt af van de N/P-kant van Persoonlijkheid (sn en jp, 1 = N resp. P). */
export function initiativeIntervalMs(axes: { sn: number; jp: number } | null, baseMs: number): number {
  if (!axes) return baseMs;
  const score = (axes.sn + axes.jp) / 2;
  // 0 -> 2x basis (zeldzaam), 0.5 -> basis, 1 -> 0.5x basis (vaak).
  return baseMs * 2 ** (1 - 2 * score);
}

const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Periodieke initiatief-check. Elke ronde wacht `intervalMs() x (0.5 + random())` en vuurt dan `onCheck`, maar alleen
 * als `isQuiet()` (nooit tijdens een lopend antwoord); de volgende ronde start pas als `onCheck` klaar is.
 */
export function createInitiativeTimer(options: {
  intervalMs: () => number;
  random: () => number;
  isQuiet: () => boolean;
  onCheck: () => void | Promise<void>;
}) {
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;

  function schedule(): void {
    if (disposed) return;
    clearTimeout(timer);
    const delay = Math.min(MAX_TIMER_MS, options.intervalMs() * (0.5 + options.random()));
    timer = setTimeout(async () => {
      timer = undefined;
      if (options.isQuiet()) {
        try {
          await options.onCheck();
        } catch (error) {
          console.warn("Initiatief-check faalde:", error instanceof Error ? error.message : error);
        }
      }
      if (!timer) schedule(); // een reset tijdens een trage check heeft al herpland
    }, delay);
  }

  return {
    start: schedule,
    reset: schedule,
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

export const DEFAULT_INITIATIVE_MINUTES = 10;

/** Parseert INITIATIVE_CHECK_MINUTES (het basisinterval bij een neutrale N/P-kant); ongeldig geeft een waarschuwing. */
export function parseInitiativeMinutes(value: string | undefined): { ms: number; warning?: string } {
  const fallback = DEFAULT_INITIATIVE_MINUTES * 60_000;
  if (value === undefined || value.trim() === "") return { ms: fallback };
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ms: fallback, warning: `INITIATIVE_CHECK_MINUTES="${value}" is ongeldig; default ${DEFAULT_INITIATIVE_MINUTES} minuten.` };
  }
  return { ms: minutes * 60_000 };
}
