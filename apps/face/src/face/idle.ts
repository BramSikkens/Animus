export type IdleOffsets = {
  /** Ooglid-multiplier 0..1; 1 = ogen open (geen blink). */
  blink: number;
  breathScale: number;
  breathY: number;
  pupilX: number;
  pupilY: number;
  browRaise: number;
};

/** Maximale afwijking per offset (breathScale: afwijking van 1). */
export const IDLE_AMPLITUDE = { breathScale: 0.015, breathY: 1.5, pupilX: 2, pupilY: 2, browRaise: 1.5 } as const;

const BLINK_CYCLE = 4; // s; blink-start ligt per cyclus deterministisch op 0.5-3 s
const BLINK_DURATION = 0.15; // s

// Deterministische pseudo-random in [0,1) uit een geheel getal (geen Math.random).
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function blink(t: number): number {
  const cycle = Math.floor(t / BLINK_CYCLE);
  const local = t - cycle * BLINK_CYCLE - (0.5 + 2.5 * hash(cycle));
  if (local < 0 || local >= BLINK_DURATION) return 1;
  return 1 - Math.sin((Math.PI * local) / BLINK_DURATION);
}

// Som van twee sinussen met onderling irrationele periodes, genormaliseerd naar [-1, 1].
function wave(t: number, p1: number, p2: number): number {
  const tau = 2 * Math.PI;
  return (Math.sin((tau * t) / p1) + 0.5 * Math.sin((tau * t) / p2)) / 1.5;
}

/** Idle-offsets als pure functie van verstreken tijd (seconden). */
export function idleOffsets(tSeconds: number): IdleOffsets {
  const t = tSeconds;
  const breath = wave(t, 4, 4 * Math.SQRT2);
  return {
    blink: blink(t),
    breathScale: 1 + IDLE_AMPLITUDE.breathScale * breath,
    breathY: IDLE_AMPLITUDE.breathY * breath,
    pupilX: IDLE_AMPLITUDE.pupilX * wave(t, Math.E * 2, Math.PI * 3),
    pupilY: IDLE_AMPLITUDE.pupilY * wave(t, Math.PI * 2.5, Math.E * 3.3),
    browRaise: IDLE_AMPLITUDE.browRaise * wave(t, Math.SQRT2 * 5, Math.PI * 4),
  };
}
