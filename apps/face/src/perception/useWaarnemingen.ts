import { useEffect } from "react";
import { FaceDetector, ObjectDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { useLocalParticipant } from "@livekit/components-react";
import { encodeEmbedding, PERCEPTION_TOPIC, type Waarneming } from "@animus/brain/perception";
import { createPresence } from "./presence.js";
import { createObjectTracker } from "./objects.js";
import { createFaceSendRule } from "./face-send.js";
import { embed } from "./face-embeddings.js";
import type { VideoBox } from "./overlay.js";

// Zelfde @mediapipe/tasks-vision-versie als in package.json (`pnpm ls @mediapipe/tasks-vision`).
// ponytail: WASM en model komen runtime van jsdelivr/googleapis; zelf hosten (public/) als offline (Pi) ooit telt.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const OBJECT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const DETECT_INTERVAL_MS = 200; // ~5 fps: genoeg voor aanwezigheid, scheelt CPU.
const OBJECT_DETECT_INTERVAL_MS = 1000; // ~1 Hz: objecten veranderen traag, gezichtsdetectie hoeft dat tempo niet te delen.
const PRESENCE_DEBOUNCE_MS = 1500;
const OBJECT_MIN_SCORE = 0.6;
const OBJECT_STABLE_MS = 1000;
// Ruim boven OBJECT_STABLE_MS: wat bij het wakker worden al stabiel in beeld staat (bureau, stoel) telt zo zeker als "al gezien".
const OBJECT_WARMUP_MS = 3000;
const FACE_SEND_INTERVAL_MS = 3000; // ADR-0020: niet per frame, bij verschijnen en daarna om de paar seconden.

/** Laatste detecties + de videobron zelf, voor de KijkSnapshot (#88): hergebruikt de detecties uit de tick, geen extra detectorcall. */
export type VisionSnapshot = {
  video: HTMLVideoElement;
  faces: VideoBox[];
  objects: { box: VideoBox; name: string; score: number }[];
};

/** Maakt `create` met GPU-delegate; faalt dat, dan een keer terugval op CPU (console.warn i.p.v. stille crash). */
async function createWithGpuFallback<T>(create: (delegate: "GPU" | "CPU") => Promise<T>, label: string): Promise<T> {
  try {
    return await create("GPU");
  } catch (error) {
    console.warn(`${label}: GPU-delegate faalde, terugval naar CPU.`, error instanceof Error ? error.message : error);
    return create("CPU");
  }
}

/**
 * MediaPipe-adapter (ADR-0018): detecteert gezicht én objecten (COCO) in de al gepubliceerde lokale cameratrack
 * (geen tweede getUserMedia, geen zichtbaar beeld) en publiceert aanwezig/afwezig/nieuw-object-Waarnemingen op
 * PERCEPTION_TOPIC. Actief enkel als `enabled` (dezelfde voorwaarde als CameraControl). Geen tests (adapter, #83/#87).
 */
export function useWaarnemingen({
  enabled,
  facePosition,
  vision,
}: {
  enabled: boolean;
  /** Genormaliseerd (0..1) midden van het gedetecteerde gezicht; ref zodat updates geen re-render kosten. */
  facePosition?: { current: { x: number; y: number } | null };
  /** Laatste detecties + video, voor de KijkSnapshot; ref zodat updates geen re-render kosten. */
  vision?: { current: VisionSnapshot | null };
}): null {
  const { localParticipant, cameraTrack } = useLocalParticipant();
  const mediaStreamTrack = cameraTrack?.track?.mediaStreamTrack;

  useEffect(() => {
    if (!enabled || !mediaStreamTrack) return;

    let cancelled = false;
    let detector: FaceDetector | undefined;
    let objectDetector: ObjectDetector | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const presence = createPresence({ debounceMs: PRESENCE_DEBOUNCE_MS });
    const objects = createObjectTracker({ minScore: OBJECT_MIN_SCORE, stableMs: OBJECT_STABLE_MS, warmupMs: OBJECT_WARMUP_MS });
    const faceSendRule = createFaceSendRule({ intervalMs: FACE_SEND_INTERVAL_MS });
    let embedding = false; // in-flight-guard: embed() is async, nooit overlappend aanroepen
    const publish = (message: Waarneming): void => {
      localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: PERCEPTION_TOPIC })
        .catch((error: unknown) => console.error("Waarneming publiceren faalde:", error instanceof Error ? error.message : error));
    };
    // Niet in de DOM: enkel als frame-bron voor MediaPipe, geen zichtbaar camerabeeld.
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([mediaStreamTrack]);

    void (async () => {
      try {
        await video.play();
        const wasmFileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        if (cancelled) return;
        detector = await createWithGpuFallback(
          (delegate) => FaceDetector.createFromOptions(wasmFileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "VIDEO" }),
          "Gezichtsdetectie (MediaPipe)",
        );
        if (cancelled) {
          detector.close();
          return;
        }
        // Een falend objectmodel mag de (al werkende) gezichtsdetectie niet meeslepen: eigen try/catch.
        try {
          objectDetector = await createWithGpuFallback(
            (delegate) =>
              ObjectDetector.createFromOptions(wasmFileset, {
                baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate },
                runningMode: "VIDEO",
                scoreThreshold: OBJECT_MIN_SCORE,
                maxResults: 10, // ruim: personen en meubels mogen een nieuw object niet uit de lijst drukken
              }),
            "Objectdetectie (MediaPipe)",
          );
          if (cancelled) {
            objectDetector.close();
            objectDetector = undefined;
          }
        } catch (error) {
          console.error("Objectdetectie (MediaPipe) laden faalde:", error instanceof Error ? error.message : error);
        }
        let lastObjectDetectT = 0;
        let lastVisionObjects: VisionSnapshot["objects"] = [];
        interval = setInterval(() => {
          if (!detector || video.readyState < video.HAVE_CURRENT_DATA) return;
          const t = performance.now();
          const { detections } = detector.detectForVideo(video, t);
          const waarneming = presence.update(detections.length > 0, t);
          if (waarneming) publish({ soort: waarneming });
          if (waarneming === "afwezig" && facePosition) facePosition.current = null;

          // Gezichts-embeddings (#93): nooit per frame, enkel bij verschijnen en daarna elke FACE_SEND_INTERVAL_MS.
          // faceSendRule.update() draait elke tick (anders schuift zijn interval-klok op zodra een embed in-flight
          // is); enkel het STARTEN van een nieuwe embed()-aanroep wordt overgeslagen zolang de vorige nog loopt.
          const shouldSendFaces = faceSendRule.update(detections.length, t);
          if (shouldSendFaces && !embedding) {
            embedding = true;
            void embed(video)
              .then((embeddings) => {
                if (cancelled) return; // opgeruimd terwijl embed() liep: niet meer publiceren
                for (const face of embeddings) publish({ soort: "gezicht", embedding: encodeEmbedding(face), aantal: embeddings.length });
              })
              .finally(() => {
                embedding = false;
              });
          }

          const box = facePosition ? detections[0]?.boundingBox : undefined;
          if (box && video.videoWidth > 0 && video.videoHeight > 0) {
            facePosition!.current = {
              x: (box.originX + box.width / 2) / video.videoWidth,
              y: (box.originY + box.height / 2) / video.videoHeight,
            };
          }

          // Objectdetectie op ~1 Hz (OBJECT_DETECT_INTERVAL_MS): trager dan gezichtsdetectie, objecten
          // veranderen traag. Tussen ticks in hergebruiken we de laatst bekende visionObjects.
          if (objectDetector && t - lastObjectDetectT >= OBJECT_DETECT_INTERVAL_MS) {
            lastObjectDetectT = t;
            const { detections: objectDetections } = objectDetector.detectForVideo(video, t);
            const metCategorie = objectDetections.filter((d) => d.categories.length > 0 && d.boundingBox);
            const gedetecteerd = metCategorie.map((d) => ({ category: d.categories[0]!.categoryName, score: d.categories[0]!.score }));
            for (const object of objects.update(gedetecteerd, t)) publish({ soort: "nieuw-object", object });
            lastVisionObjects = metCategorie.map((d) => ({ box: d.boundingBox!, name: d.categories[0]!.categoryName, score: d.categories[0]!.score }));
          }
          if (vision) {
            const visionFaces = detections
              .map((d) => d.boundingBox)
              .filter((b): b is NonNullable<typeof b> => b != null)
              .map(({ originX, originY, width, height }) => ({ originX, originY, width, height }));
            vision.current = { video, faces: visionFaces, objects: lastVisionObjects };
          }
        }, DETECT_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return; // play() rejectt na de cleanup: geen fout
        console.error("Waarnemingen (MediaPipe) laden faalde:", error instanceof Error ? error.message : error);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      detector?.close();
      objectDetector?.close();
      video.pause();
      video.srcObject = null;
      if (facePosition) facePosition.current = null;
      if (vision) vision.current = null;
    };
  }, [enabled, mediaStreamTrack, localParticipant, facePosition, vision]);

  return null;
}
