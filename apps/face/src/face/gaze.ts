type Point = { x: number; y: number };

const clamp = (n: number) => Math.min(1, Math.max(-1, n));

/**
 * Pupil-offset (viewBox-eenheden) richting de muisaanwijzer, geclampt op ±max; null geeft {0,0}.
 * De afstand wordt genormaliseerd op het halve venster, zodat de rand van het scherm max oplevert.
 */
export function gazeOffset({ pointer, viewport, faceCenter, max }: { pointer: Point | null; viewport: { w: number; h: number }; faceCenter: Point; max: number }): { dx: number; dy: number } {
  if (!pointer) return { dx: 0, dy: 0 };
  return {
    dx: clamp((pointer.x - faceCenter.x) / (viewport.w / 2)) * max || 0,
    dy: clamp((pointer.y - faceCenter.y) / (viewport.h / 2)) * max || 0,
  };
}

/**
 * Aanwijzerpositie voor het venster op basis van het genormaliseerde (0..1) gezichtsmidden in het
 * camerabeeld, horizontaal gespiegeld zodat de Dynimo je aankijkt i.p.v. je camerabeeld natekent.
 */
export function facePointer({ face, viewport }: { face: Point; viewport: { w: number; h: number } }): Point {
  return { x: (1 - face.x) * viewport.w, y: face.y * viewport.h };
}

/**
 * Aandeel van de idle-dwaling (idle.ts, ±2) dat overblijft terwijl de ogen iets volgen. Volledig bovenop de blik
 * (bereik ±3) dwaalde de pupil tot bijna het midden terug en leek hij weg te kijken van wie hij volgt.
 */
export const IDLE_PUPIL_WHILE_TRACKING = 0.25;

/** Pupilpositie: de (per `idleWeight` gedempte) idle-dwaling plus de afgevlakte blikrichting. */
export function pupilPosition({ idle, gaze, idleWeight }: { idle: { pupilX: number; pupilY: number }; gaze: { dx: number; dy: number }; idleWeight: number }): Point {
  return { x: idle.pupilX * idleWeight + gaze.dx, y: idle.pupilY * idleWeight + gaze.dy };
}
