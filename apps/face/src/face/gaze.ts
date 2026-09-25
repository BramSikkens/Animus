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
