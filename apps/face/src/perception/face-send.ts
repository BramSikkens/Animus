// Zelfde debounce als presence.ts: een gemist frame (kort geen gezicht) mag niet als nieuwe verschijning tellen.
const ABSENCE_DEBOUNCE_MS = 1500;

/**
 * Pure verzendregel voor gezichts-embeddings (#93): niet per frame, maar bij verschijnen (0 → ≥1 gezicht) en
 * daarna telkens na `intervalMs` zolang er gezichten zijn. Geen gezichten: geen verzending. Een onderbreking
 * korter dan ABSENCE_DEBOUNCE_MS telt niet als verdwijnen: het lopende interval blijft gewoon doorlopen.
 */
export function createFaceSendRule({ intervalMs = 3000 }: { intervalMs?: number } = {}) {
  let wasPresent = false;
  let lastSentAt: number | undefined;
  let absentSince: number | undefined;

  return {
    update(facesInView: number, t: number): boolean {
      const present = facesInView > 0;
      if (!present) {
        if (absentSince === undefined) absentSince = t;
        if (wasPresent && t - absentSince >= ABSENCE_DEBOUNCE_MS) {
          wasPresent = false;
          lastSentAt = undefined;
        }
        return false;
      }
      // De afwezigheid eindigt hier; check ook nu of ze al ABSENCE_DEBOUNCE_MS duurde (er hoeft geen tussentijdse
      // "nog steeds afwezig"-aanroep geweest te zijn op precies dat moment).
      if (absentSince !== undefined && t - absentSince >= ABSENCE_DEBOUNCE_MS) {
        wasPresent = false;
        lastSentAt = undefined;
      }
      absentSince = undefined;
      const justAppeared = !wasPresent;
      wasPresent = true;
      if (justAppeared || lastSentAt === undefined || t - lastSentAt >= intervalMs) {
        lastSentAt = t;
        return true;
      }
      return false;
    },
  };
}
