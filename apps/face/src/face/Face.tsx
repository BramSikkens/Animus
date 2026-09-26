import { useEffect, useRef, useState } from "react";
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import type { DisplayState } from "@animus/brain/display";
import type { Emotion } from "@animus/brain/emotion";
import { doodlePath } from "./doodle.js";
import { facePointer, gazeOffset, IDLE_PUPIL_WHILE_TRACKING, pupilPosition } from "./gaze.js";
import { idleOffsets } from "./idle.js";
import { frameForDisplay } from "./interpolate.js";
import type { Keyframe } from "./keyframes.js";
import { microExpression } from "./micro.js";
import { mouthOpenForVolume } from "./mouth.js";
import type { VoiceReaction } from "./voice-reaction.js";

// Eén lijn- en vulkleur voor het hele gezicht (ogen, mond, wenkbrauwen); de achtergrond
// verandert per emotie, het gezicht zelf blijft monochroom.
const FACE_COLOR = "#f4efe3";
const TRANSITION = { duration: 0.4, ease: "easeInOut" } as const;
// Tijdens spreekt volgt de mond het volume; een korte tween houdt hem vloeiend zonder te laten achterlopen.
const MOUTH_SPEAK_TRANSITION = { duration: 0.08, ease: "linear" } as const;

const DOODLE_SEED = 1;

const GAZE_MAX = 3; // viewBox-eenheden: klein bereik, de pupil blijft binnen het oog
const GAZE_SMOOTHING = 0.12; // aandeel van de resterende afstand per frame
const FROWN_BROW_DROP = 2.5;
// De uiting van de gebruiker stuurt micro-expressies maar kort; daarna zakt het gezicht terug.
const RECENT_TEXT_MS = 4000;

// Stemreactie (#76): extra offsets bovenop idle/micro, alleen tijdens luisterend.
const STARTLE_EYE_SCALE = 0.25;
const STARTLE_BROW_RAISE = 6;
const LEAN_EYE_SCALE = 0.1;
const LEAN_FACE_SCALE = 0.04;
const ALERT_PUPIL_SHRINK = 0.3;
const LEAN_SMOOTHING = 0.06;
const NO_VOICE: VoiceReaction = { startle: 0, lean: 0, alert: 0 };

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

// Idle-laag: MotionValues die per frame door useAnimationFrame worden gezet en via wrapper-<g>'s
// ADDITIEF over de Motion-tweens heen liggen (tween en idle raken elkaar dus niet).
type Idle = { eyeScale: MotionValue<number>; pupilScale: MotionValue<number>; blink: MotionValue<number>; pupilX: MotionValue<number>; pupilY: MotionValue<number>; browY: MotionValue<number> };

type EyeProps = { cx: number; eye: Keyframe["eyes"]["left"]; background: string; idle: Idle };

function Eye({ cx, eye, background, idle }: EyeProps) {
  return (
    <motion.g style={{ scale: idle.eyeScale, scaleY: idle.blink, transformBox: "view-box", transformOrigin: `${cx}px ${EYE_Y}px` }}>
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
      <motion.g style={{ x: idle.pupilX, y: idle.pupilY, scale: idle.pupilScale, transformBox: "view-box", transformOrigin: `${cx}px ${EYE_Y}px` }}>
        <motion.circle
          initial={false}
          animate={{ cx: cx + eye.pupilX, cy: EYE_Y + eye.pupilY, r: 5 * eye.scale, fill: background }}
          transition={TRANSITION}
        />
      </motion.g>
    </motion.g>
  );
}

type BrowProps = { cx: number; side: "left" | "right"; brow: Keyframe["brow"]; browY: MotionValue<number> };

function Brow({ cx, side, brow, browY }: BrowProps) {
  const angle = brow?.angle ?? 0;
  const raise = brow?.raise ?? 0;
  // Spiegeling: linkerbrauw roteert met +angle, rechter met -angle. Bij een positieve angle
  // (boos) wijst de binnenkant van beide dan naar beneden (V-vorm); bij negatief (bang) omhoog.
  const rotation = side === "left" ? angle : -angle;
  return (
    <motion.g style={{ y: browY }}>
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
    </motion.g>
  );
}

export type FaceProps = {
  /** Lange stilte: toon de doodle i.p.v. het gezicht. */
  doodle?: boolean;
  display: DisplayState;
  emotion: Emotion;
  intensity: number;
  /** Volume 0..1 van de agent-audiotrack; stuurt de mondopening alleen tijdens "spreekt". Ref (zoals
   * `voice`/`facePosition`) zodat App niet per audioframe rendert; Face leest 'm in zijn eigen animatielus. */
  mouthVolume?: { current: number };
  /** Volledige emotievector; voedt de frons (boos >= 60). */
  values?: Record<Emotion, number>;
  /** Laatste uiting van de Gesprekspartner (transcriptie); voedt vraag-wenkbrauw en glimlach. */
  lastUserText?: string;
  /** Stemreactie op de microfoon van de Gesprekspartner; ref zodat updates geen re-render kosten. */
  voice?: { current: VoiceReaction };
  /** Genormaliseerd (0..1) gezichtsmidden uit de camera; stuurt de blikrichting i.p.v. de muis. Ref zodat updates geen re-render kosten. */
  facePosition?: { current: { x: number; y: number } | null };
};

/** Het gezichtje: achtergrond + ogen + mond + wenkbrauwen, getweend tussen emoties en de slaapstand (~300-500ms). */
export function Face({ doodle = false, display, emotion, intensity, mouthVolume, values, lastUserText, voice, facePosition }: FaceProps) {
  const reduced = useReducedMotion();
  const [recentText, setRecentText] = useState<string>();
  useEffect(() => {
    setRecentText(lastUserText);
    if (!lastUserText) return;
    const id = setTimeout(() => setRecentText(undefined), RECENT_TEXT_MS);
    return () => clearTimeout(id);
  }, [lastUserText]);
  const micro = reduced ? { browRaise: 0, frown: 0, smile: 0 } : microExpression({ displayState: display, lastUserText: recentText, values });
  const frame = frameForDisplay(display, emotion, intensity);
  const speaking = display === "spreekt";
  const baseMouth = { ...frame.mouth, curve: frame.mouth.curve + micro.smile };
  // Mondvolume komt binnen als ref (App rendert niet per audioframe); dit leest 'm in de eigen animatielus
  // hieronder en spiegelt 'm naar lokale state, met dezelfde afronding als voorheen om onnodige renders te schelen.
  const [liveMouthVolume, setLiveMouthVolume] = useState(0);
  const mouth = speaking ? { ...baseMouth, open: Math.max(frame.mouth.open, mouthOpenForVolume(liveMouthVolume)) } : baseMouth;
  // Muispositie in een ref; useAnimationFrame is de per-frame-throttle (geen extra rAF).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const gaze = useRef({ dx: 0, dy: 0 });
  // Afgevlakt, zodat de pupil niet verspringt als er een gezicht (of de muis) verschijnt of verdwijnt.
  const idleWeight = useRef(1);
  useEffect(() => {
    const onMove = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  const blink = useMotionValue(1);
  const pupilX = useMotionValue(0);
  const pupilY = useMotionValue(0);
  const browY = useMotionValue(0);
  const breathScale = useMotionValue(1);
  const breathY = useMotionValue(0);
  const eyeScale = useMotionValue(1);
  const pupilScale = useMotionValue(1);
  const lean = useRef(0);
  // Dunne lijm: pure idleOffsets(t) naar MotionValues; loopt in elke Weergavetoestand door.
  useAnimationFrame((timeMs) => {
    if (mouthVolume) {
      const rounded = Math.round(mouthVolume.current * 100) / 100;
      setLiveMouthVolume((prev) => (prev === rounded ? prev : rounded));
    }
    const o = idleOffsets(timeMs / 1000);
    blink.set(Math.max(o.blink, 0.05));
    const aanwijzer = facePosition?.current
      ? facePointer({ face: facePosition.current, viewport: { w: window.innerWidth, h: window.innerHeight } })
      : pointer.current;
    const tracking = aanwijzer !== null && !reduced && display !== "slapend";
    const target = tracking
      ? gazeOffset({ pointer: aanwijzer, viewport: { w: window.innerWidth, h: window.innerHeight }, faceCenter: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, max: GAZE_MAX })
      : { dx: 0, dy: 0 };
    gaze.current.dx += (target.dx - gaze.current.dx) * GAZE_SMOOTHING;
    gaze.current.dy += (target.dy - gaze.current.dy) * GAZE_SMOOTHING;
    idleWeight.current += ((tracking ? IDLE_PUPIL_WHILE_TRACKING : 1) - idleWeight.current) * GAZE_SMOOTHING;
    const pupil = pupilPosition({ idle: o, gaze: gaze.current, idleWeight: idleWeight.current });
    pupilX.set(pupil.x);
    pupilY.set(pupil.y);
    const v = reduced || display !== "luisterend" ? NO_VOICE : (voice?.current ?? NO_VOICE);
    lean.current += (v.lean - lean.current) * LEAN_SMOOTHING;
    eyeScale.set(1 + v.startle * STARTLE_EYE_SCALE + lean.current * LEAN_EYE_SCALE);
    pupilScale.set(1 - v.alert * ALERT_PUPIL_SHRINK);
    browY.set(-o.browRaise - micro.browRaise + micro.frown * FROWN_BROW_DROP - v.startle * STARTLE_BROW_RAISE);
    breathScale.set(o.breathScale * (1 + lean.current * LEAN_FACE_SCALE));
    breathY.set(o.breathY);
  });
  const doodleD = useMotionValue(doodlePath(0, DOODLE_SEED));
  useAnimationFrame((timeMs) => {
    if (doodle) doodleD.set(doodlePath(timeMs / 1000, DOODLE_SEED));
  });
  const idle = { eyeScale, pupilScale, blink, pupilX, pupilY, browY };
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
        {doodle ? (
          <motion.path d={doodleD} fill="none" stroke={FACE_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
        <motion.g style={{ scale: breathScale, y: breathY, transformBox: "view-box", transformOrigin: "100px 100px" }}>
          <Eye cx={EYE_X.left} eye={frame.eyes.left} background={frame.background} idle={idle} />
          <Eye cx={EYE_X.right} eye={frame.eyes.right} background={frame.background} idle={idle} />
          <Brow cx={EYE_X.left} side="left" brow={frame.brow} browY={browY} />
          <Brow cx={EYE_X.right} side="right" brow={frame.brow} browY={browY} />
          <motion.path initial={false} animate={{ d: mouthPath(mouth) }} transition={speaking ? MOUTH_SPEAK_TRANSITION : TRANSITION} fill={FACE_COLOR} />
        </motion.g>
        )}
      </svg>
    </div>
  );
}
