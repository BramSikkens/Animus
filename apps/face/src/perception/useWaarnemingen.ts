import { useEffect } from "react";
import { FaceDetector, ObjectDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { useLocalParticipant } from "@livekit/components-react";
import { PERCEPTION_TOPIC, type Waarneming } from "@animus/brain/perception";
import { createPresence } from "./presence.js";
import { createObjectTracker } from "./objects.js";

// Zelfde @mediapipe/tasks-vision-versie als in package.json (`pnpm ls @mediapipe/tasks-vision`).
// ponytail: WASM en model komen runtime van jsdelivr/googleapis; zelf hosten (public/) als offline (Pi) ooit telt.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const OBJECT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const DETECT_INTERVAL_MS = 200; // ~5 fps: genoeg voor aanwezigheid, scheelt CPU.
const PRESENCE_DEBOUNCE_MS = 1500;
const OBJECT_MIN_SCORE = 0.6;
const OBJECT_STABLE_MS = 1000;
// Ruim boven OBJECT_STABLE_MS: wat bij het wakker worden al stabiel in beeld staat (bureau, stoel) telt zo zeker als "al gezien".
const OBJECT_WARMUP_MS = 3000;

/**
 * MediaPipe-adapter (ADR-0018): detecteert gezicht én objecten (COCO) in de al gepubliceerde lokale cameratrack
 * (geen tweede getUserMedia, geen zichtbaar beeld) en publiceert aanwezig/afwezig/nieuw-object-Waarnemingen op
 * PERCEPTION_TOPIC. Actief enkel als `enabled` (dezelfde voorwaarde als CameraControl). Geen tests (adapter, #83/#87).
 */
export function useWaarnemingen({ enabled }: { enabled: boolean }): null {
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
        detector = await FaceDetector.createFromOptions(wasmFileset, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "VIDEO",
        });
        if (cancelled) {
          detector.close();
          return;
        }
        // Een falend objectmodel mag de (al werkende) gezichtsdetectie niet meeslepen: eigen try/catch.
        try {
          objectDetector = await ObjectDetector.createFromOptions(wasmFileset, {
            baseOptions: { modelAssetPath: OBJECT_MODEL_URL },
            runningMode: "VIDEO",
            scoreThreshold: OBJECT_MIN_SCORE,
            maxResults: 5,
          });
          if (cancelled) {
            objectDetector.close();
            objectDetector = undefined;
          }
        } catch (error) {
          console.error("Objectdetectie (MediaPipe) laden faalde:", error instanceof Error ? error.message : error);
        }
        interval = setInterval(() => {
          if (!detector || video.readyState < video.HAVE_CURRENT_DATA) return;
          const t = performance.now();
          const { detections } = detector.detectForVideo(video, t);
          const waarneming = presence.update(detections.length > 0, t);
          if (waarneming) publish({ soort: waarneming });

          if (objectDetector) {
            const { detections: objectDetections } = objectDetector.detectForVideo(video, t);
            const gedetecteerd = objectDetections
              .filter((d) => d.categories.length > 0)
              .map((d) => ({ category: d.categories[0]!.categoryName, score: d.categories[0]!.score }));
            for (const object of objects.update(gedetecteerd, t)) publish({ soort: "nieuw-object", object });
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
    };
  }, [enabled, mediaStreamTrack, localParticipant]);

  return null;
}
