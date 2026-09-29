import type { DisplayState } from "@animus/core/display";

/** Doodle-modus: lang genoeg stil, en niet reflecterend (wint) of slapend (houdt het slaapgezicht). */
export function doodleActive({ idleMs, thresholdMs, display }: { idleMs: number; thresholdMs: number; display: DisplayState }): boolean {
  return idleMs >= thresholdMs && display !== "reflecterend" && display !== "slapend";
}

const POINTS = 240;

/** Langzaam evoluerende krabbel (Lissajous met driftende fase) als SVG-path in viewBox 0..200; bepaald in t (seconden) en seed. */
export function doodlePath(t: number, seed: number): string {
  const a = 3 + (seed % 3);
  const b = 4 + (seed % 5);
  const drift = t * 0.05;
  let d = "";
  for (let i = 0; i < POINTS; i++) {
    const u = (i / (POINTS - 1)) * 2 * Math.PI;
    const x = 100 + 80 * Math.sin(a * u + drift) + 10 * Math.sin(7 * u - 2 * drift);
    const y = 100 + 80 * Math.sin(b * u + 1.7 * drift) + 10 * Math.cos(5 * u + drift);
    d += `${i === 0 ? "M" : "L"} ${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100} `;
  }
  return d.trim();
}
