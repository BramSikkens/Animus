import type { Emotion } from "@animus/core/emotion";

/** Eén oog. `open` is de ooglid-opening (0 dicht .. 1 volledig open), `scale` de oogomvang (~0.6..1.4). */
type Eye = { open: number; scale: number; pupilX: number; pupilY: number };

/** De mond. `curve` -1 (frons) .. 1 (lach), `open` 0 (dicht) .. 1 (wijd open). */
type Mouth = { width: number; curve: number; open: number };

/**
 * Eén wenkbrauw. `angle` in graden: positief kantelt de binnenkant (richting neus) omlaag
 * (bv. boos), negatief kantelt ze omhoog (bv. bang). `raise` in viewBox-eenheden, positief = omhoog.
 */
type Brow = { angle: number; raise: number };

export type Keyframe = {
  eyes: { left: Eye; right: Eye };
  mouth: Mouth;
  /** #rrggbb */
  background: string;
  /** Enkel gezet voor verrast/boos/bang/droevig; de rest gebruikt de neutraal-rechte stand. */
  brow?: Brow;
};

const EYE_NEUTRAL: Eye = { open: 1, scale: 1, pupilX: 0, pupilY: 0 };

export const NEUTRAL: Keyframe = {
  eyes: { left: EYE_NEUTRAL, right: EYE_NEUTRAL },
  mouth: { width: 36, curve: 0, open: 0 },
  background: "#555555",
};

export const KEYFRAMES = {
  blij: {
    eyes: {
      left: { open: 0.7, scale: 1, pupilX: 0, pupilY: 0 },
      right: { open: 0.7, scale: 1, pupilX: 0, pupilY: 0 },
    },
    mouth: { width: 52, curve: 0.85, open: 0.3 },
    background: "#b8873f",
  },
  boos: {
    eyes: {
      left: { open: 0.5, scale: 0.85, pupilX: 0, pupilY: 2 },
      right: { open: 0.5, scale: 0.85, pupilX: 0, pupilY: 2 },
    },
    mouth: { width: 34, curve: -0.7, open: 0.1 },
    background: "#8a3a3a",
    brow: { angle: 25, raise: -4 },
  },
  verrast: {
    eyes: {
      left: { open: 1, scale: 1.3, pupilX: 0, pupilY: 0 },
      right: { open: 1, scale: 1.3, pupilX: 0, pupilY: 0 },
    },
    mouth: { width: 28, curve: 0, open: 0.9 },
    background: "#3f8f95",
    brow: { angle: 0, raise: 10 },
  },
  kalm: {
    eyes: {
      left: { open: 0.4, scale: 0.9, pupilX: 0, pupilY: 0 },
      right: { open: 0.4, scale: 0.9, pupilX: 0, pupilY: 0 },
    },
    mouth: { width: 36, curve: 0.3, open: 0.05 },
    background: "#4a6b6a",
  },
  verveeld: {
    eyes: {
      left: { open: 0.3, scale: 0.9, pupilX: 4, pupilY: 3 },
      right: { open: 0.3, scale: 0.9, pupilX: 4, pupilY: 3 },
    },
    mouth: { width: 38, curve: 0, open: 0.05 },
    background: "#5c5a4a",
  },
  nieuwsgierig: {
    eyes: {
      left: { open: 1, scale: 1.15, pupilX: 5, pupilY: 0 },
      right: { open: 0.85, scale: 0.95, pupilX: 5, pupilY: 0 },
    },
    mouth: { width: 34, curve: 0.2, open: 0.15 },
    background: "#5a4a7a",
  },
  bang: {
    eyes: {
      left: { open: 1, scale: 1.25, pupilX: 0, pupilY: -2 },
      right: { open: 1, scale: 1.25, pupilX: 0, pupilY: -2 },
    },
    mouth: { width: 28, curve: -0.3, open: 0.6 },
    background: "#3a3a5c",
    brow: { angle: -20, raise: 8 },
  },
  droevig: {
    eyes: {
      left: { open: 0.55, scale: 0.95, pupilX: 0, pupilY: 4 },
      right: { open: 0.55, scale: 0.95, pupilX: 0, pupilY: 4 },
    },
    mouth: { width: 32, curve: -0.5, open: 0 },
    background: "#3d4a5c",
    brow: { angle: -15, raise: 2 },
  },
  vredig: {
    eyes: {
      left: { open: 0.25, scale: 0.95, pupilX: 0, pupilY: 0 },
      right: { open: 0.25, scale: 0.95, pupilX: 0, pupilY: 0 },
    },
    mouth: { width: 40, curve: 0.5, open: 0 },
    background: "#5a6b58",
  },
  druk: {
    eyes: {
      left: { open: 1, scale: 1.1, pupilX: 3, pupilY: -1 },
      right: { open: 1, scale: 1.1, pupilX: 3, pupilY: -1 },
    },
    mouth: { width: 40, curve: 0.1, open: 0.35 },
    background: "#7a4f6b",
  },
} satisfies Record<Emotion, Keyframe>;

/** Weergavetoestand "slapend": ogen (bijna) dicht, vlakke mond, gedempte donkere achtergrond, geen emotie. */
const EYE_CLOSED: Eye = { open: 0.08, scale: 1, pupilX: 0, pupilY: 0 };

export const SLEEP: Keyframe = {
  eyes: { left: EYE_CLOSED, right: EYE_CLOSED },
  mouth: { width: 30, curve: 0, open: 0 },
  background: "#22222b",
};

/** Weergavetoestand "reflecterend": ogen half gesloten met de blik omhoog/opzij, rustige vlakke mond, blauwig gedempt. */
const EYE_THINKING: Eye = { open: 0.45, scale: 1, pupilX: 3, pupilY: -4 };

export const REFLECT: Keyframe = {
  eyes: { left: EYE_THINKING, right: EYE_THINKING },
  mouth: { width: 30, curve: 0, open: 0 },
  background: "#2b3247",
};
