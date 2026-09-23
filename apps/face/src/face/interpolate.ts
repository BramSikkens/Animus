import type { Emotion } from "@animus/brain/emotion";
import { KEYFRAMES, NEUTRAL, type Keyframe } from "./keyframes.js";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// a*(1-t) + b*t i.p.v. a+(b-a)*t: exact op t=0 én t=1 (belangrijk voor de intensiteit-1-test).
function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function lerpHexColor(a: string, b: string, t: number): string {
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  const mix = (offset: number) => Math.round(lerp(channel(a, offset), channel(b, offset), t));
  return `#${[1, 3, 5].map((offset) => mix(offset).toString(16).padStart(2, "0")).join("")}`;
}

function lerpEye(a: Keyframe["eyes"]["left"], b: Keyframe["eyes"]["left"], t: number) {
  return {
    open: lerp(a.open, b.open, t),
    scale: lerp(a.scale, b.scale, t),
    pupilX: lerp(a.pupilX, b.pupilX, t),
    pupilY: lerp(a.pupilY, b.pupilY, t),
  };
}

const BROW_NEUTRAL = { angle: 0, raise: 0 };

// Type1 scoort gewone gesprekszinnen laag (0.02-0.2); zonder ondergrens bleef het gezicht zo goed als neutraal.
const MIN_VISIBILITY = 0.35;

/**
 * Mengt tussen `NEUTRAL` en `KEYFRAMES[emotion]`: intensiteit 0 geeft MIN_VISIBILITY richting het doel,
 * intensiteit 1 het volle keyframe. Clamt naar [0, 1].
 */
export function frameFor(emotion: Emotion, intensity: number): Keyframe {
  const t = MIN_VISIBILITY + (1 - MIN_VISIBILITY) * clamp01(intensity);
  const target: Keyframe = KEYFRAMES[emotion];
  const targetBrow = target.brow ?? BROW_NEUTRAL;
  return {
    eyes: {
      left: lerpEye(NEUTRAL.eyes.left, target.eyes.left, t),
      right: lerpEye(NEUTRAL.eyes.right, target.eyes.right, t),
    },
    mouth: {
      width: lerp(NEUTRAL.mouth.width, target.mouth.width, t),
      curve: lerp(NEUTRAL.mouth.curve, target.mouth.curve, t),
      open: lerp(NEUTRAL.mouth.open, target.mouth.open, t),
    },
    background: lerpHexColor(NEUTRAL.background, target.background, t),
    brow: {
      angle: lerp(BROW_NEUTRAL.angle, targetBrow.angle, t),
      raise: lerp(BROW_NEUTRAL.raise, targetBrow.raise, t),
    },
  };
}
