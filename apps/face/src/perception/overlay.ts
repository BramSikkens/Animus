/** Rechthoek in videopixels, zoals MediaPipe die teruggeeft (FaceDetector/ObjectDetector boundingBox). */
export type VideoBox = { originX: number; originY: number; width: number; height: number };

/** Eén te tekenen kader in canvaspixels (KijkSnapshot). */
export type OverlayBox = { x: number; y: number; w: number; h: number; label?: string; kind: "gezicht" | "object" };

/**
 * Pure functie (#88, KijkSnapshot): schaalt gezicht- en objectdetecties van videopixels naar canvaspixels, en
 * spiegelt ze horizontaal als `mirror` (zoals het gezichtsbeeld zelf gespiegeld getekend wordt). `person` wordt
 * weggelaten: het gezichtskader dekt dat al.
 */
export function overlayBoxes({
  faces,
  objects,
  video,
  canvas,
  mirror,
}: {
  faces: VideoBox[];
  objects: { box: VideoBox; name: string; score: number }[];
  video: { w: number; h: number };
  canvas: { w: number; h: number };
  mirror: boolean;
}): OverlayBox[] {
  const scaleX = canvas.w / video.w;
  const scaleY = canvas.h / video.h;
  const toOverlay = (box: VideoBox, label: string | undefined, kind: OverlayBox["kind"]): OverlayBox => {
    const w = box.width * scaleX;
    const h = box.height * scaleY;
    const x = mirror ? canvas.w - (box.originX + box.width) * scaleX : box.originX * scaleX;
    return { x, y: box.originY * scaleY, w, h, ...(label !== undefined ? { label } : {}), kind };
  };
  return [
    ...faces.map((box) => toOverlay(box, undefined, "gezicht")),
    ...objects.filter((object) => object.name !== "person").map((object) => toOverlay(object.box, `${object.name} ${object.score.toFixed(2)}`, "object")),
  ];
}
