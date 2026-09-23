import { motion } from "motion/react";
import type { DisplayState } from "@animus/brain/display";
import type { Emotion } from "@animus/brain/emotion";
import { frameForDisplay } from "./interpolate.js";
import type { Keyframe } from "./keyframes.js";

// Eén lijn- en vulkleur voor het hele gezicht (ogen, mond, wenkbrauwen); de achtergrond
// verandert per emotie, het gezicht zelf blijft monochroom.
const FACE_COLOR = "#f4efe3";
const TRANSITION = { duration: 0.4, ease: "easeInOut" } as const;

const EYE_X = { left: 72, right: 128 } as const;
const EYE_Y = 85;
const EYE_BASE_R = 16;

const MOUTH_CX = 100;
const MOUTH_CY = 140;
const MOUTH_LIP_THICKNESS = 3;
const MOUTH_OPEN_RANGE = 14;
const MOUTH_CURVE_RANGE = 18;

const BROW_Y = EYE_Y - 30;
const BROW_HALF_LEN = 13;

// Afronden op 2 decimalen: Motion tweent `d` door de getallen in het path te matchen. Een ruwe
// waarde als 1.2e-16 zou in exponentnotatie printen en de match breken (path springt i.p.v. tweent).
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Alle monden gebruiken exact dezelfde commandostructuur (M + 2×C + Z), zodat Motion `d` kan
// tweenen zonder Flubber: enkel de getallen veranderen, nooit het aantal/soort commando's.
function mouthPath(mouth: Keyframe["mouth"]): string {
  const halfWidth = mouth.width / 2;
  const lx = round2(MOUTH_CX - halfWidth);
  const rx = round2(MOUTH_CX + halfWidth);
  const c1x = round2(MOUTH_CX - halfWidth / 3);
  const c2x = round2(MOUTH_CX + halfWidth / 3);
  const cy = round2(MOUTH_CY);
  const curveOffset = mouth.curve * MOUTH_CURVE_RANGE;
  const halfGap = MOUTH_LIP_THICKNESS + mouth.open * MOUTH_OPEN_RANGE;
  const topY = round2(MOUTH_CY - halfGap + curveOffset);
  const botY = round2(MOUTH_CY + halfGap + curveOffset);
  return `M ${lx} ${cy} C ${c1x} ${topY} ${c2x} ${topY} ${rx} ${cy} C ${c2x} ${botY} ${c1x} ${botY} ${lx} ${cy} Z`;
}

type EyeProps = { cx: number; eye: Keyframe["eyes"]["left"]; background: string };

function Eye({ cx, eye, background }: EyeProps) {
  return (
    <>
      <motion.ellipse
        initial={false}
        animate={{ cx, cy: EYE_Y, rx: EYE_BASE_R * eye.scale, ry: EYE_BASE_R * eye.scale * Math.max(eye.open, 0.05) }}
        transition={TRANSITION}
        fill={FACE_COLOR}
      />
      {/*
       * ponytail: de pupil krijgt de (getweende) achtergrondkleur i.p.v. een clipPath op de
       * ooglid-ellips. Zolang pupil en achtergrond exact dezelfde kleur hebben en gelijk
       * tweenen, is elk stukje pupil dat buiten de ellips uitsteekt onzichtbaar tegen de
       * achtergrond — geen aparte clip nodig. Upgradepad: een echte clipPath zodra de pupil
       * ooit een eigen kleur krijgt.
       */}
      <motion.circle
        initial={false}
        animate={{ cx: cx + eye.pupilX, cy: EYE_Y + eye.pupilY, r: 5 * eye.scale, fill: background }}
        transition={TRANSITION}
      />
    </>
  );
}

type BrowProps = { cx: number; side: "left" | "right"; brow: Keyframe["brow"] };

function Brow({ cx, side, brow }: BrowProps) {
  const angle = brow?.angle ?? 0;
  const raise = brow?.raise ?? 0;
  // Spiegeling: linkerbrauw roteert met +angle, rechter met -angle. Bij een positieve angle
  // (boos) wijst de binnenkant van beide dan naar beneden (V-vorm); bij negatief (bang) omhoog.
  const rotation = side === "left" ? angle : -angle;
  return (
    <motion.line
      x1={cx - BROW_HALF_LEN}
      y1={BROW_Y}
      x2={cx + BROW_HALF_LEN}
      y2={BROW_Y}
      initial={false}
      animate={{ y: -raise, rotate: rotation }}
      transition={TRANSITION}
      style={{ transformOrigin: `${cx}px ${BROW_Y}px` }}
      stroke={FACE_COLOR}
      strokeWidth={4}
      strokeLinecap="round"
    />
  );
}

export type FaceProps = { display: DisplayState; emotion: Emotion; intensity: number };

/** Het gezichtje: achtergrond + ogen + mond + wenkbrauwen, getweend tussen emoties en de slaapstand (~300-500ms). */
export function Face({ display, emotion, intensity }: FaceProps) {
  const frame = frameForDisplay(display, emotion, intensity);
  return (
    <div className="face-stage">
      <motion.div
        className="face-background"
        initial={false}
        animate={{ backgroundColor: frame.background }}
        transition={TRANSITION}
      />
      <svg className="face-svg" viewBox="0 0 200 200" role="img" aria-label={
          display === "slapend" ? "Animus slaapt" : display === "reflecterend" ? "Animus denkt na" : `Animus voelt zich ${emotion}`
        }>
        <Eye cx={EYE_X.left} eye={frame.eyes.left} background={frame.background} />
        <Eye cx={EYE_X.right} eye={frame.eyes.right} background={frame.background} />
        <Brow cx={EYE_X.left} side="left" brow={frame.brow} />
        <Brow cx={EYE_X.right} side="right" brow={frame.brow} />
        <motion.path initial={false} animate={{ d: mouthPath(frame.mouth) }} transition={TRANSITION} fill={FACE_COLOR} />
      </svg>
    </div>
  );
}
