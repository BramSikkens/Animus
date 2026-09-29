import { useEffect, useRef, useState } from "react";
import { useDataChannel } from "@livekit/components-react";
import { LOOK_TOPIC } from "@animus/protocol/perception";
import { overlayBoxes } from "./overlay.js";
import type { VisionSnapshot } from "./useWaarnemingen.js";

const SNAPSHOT_WIDTH = 240;
const VISIBLE_MS = 5000;
const FACE_COLOR = "#7fd4ff";
const OBJECT_COLOR = "#f4c542";

/**
 * Momentopname (~5s zichtbaar) van wat de Dynimo net zag (kijk-event, ADR-0019): tekent de huidige videoframe uit
 * `vision.current` gespiegeld op een canvas, met kaders om gezicht en objecten (overlayBoxes). Geen camerabytes
 * over het netwerk: de video staat al lokaal in de face-app (useWaarnemingen). Geen tests (React-bedrading).
 */
export function KijkSnapshot({ vision }: { vision: { current: VisionSnapshot | null } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useDataChannel(LOOK_TOPIC, (msg) => {
    if (!msg.from?.isAgent) return;
    const snapshot = vision.current;
    const canvas = canvasRef.current;
    if (!snapshot || !canvas || snapshot.video.videoWidth === 0 || snapshot.video.videoHeight === 0) return;
    const { video, faces, objects } = snapshot;
    canvas.width = SNAPSHOT_WIDTH;
    canvas.height = Math.round((SNAPSHOT_WIDTH / video.videoWidth) * video.videoHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const boxes = overlayBoxes({ faces, objects, video: { w: video.videoWidth, h: video.videoHeight }, canvas: { w: canvas.width, h: canvas.height }, mirror: true });
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "bottom";
    for (const box of boxes) {
      ctx.strokeStyle = box.kind === "gezicht" ? FACE_COLOR : OBJECT_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      if (box.label) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(box.label, box.x, Math.max(12, box.y));
      }
    }

    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  });

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return <canvas ref={canvasRef} className={`kijk-snapshot${visible ? " visible" : ""}`} role="img" aria-label="Wat de Dynimo nu ziet" />;
}
