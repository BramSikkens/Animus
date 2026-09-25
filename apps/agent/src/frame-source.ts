import sharp from "sharp";
import {
  RoomEvent,
  TrackKind,
  VideoBufferType,
  VideoStream,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  type TrackPublication,
  type VideoFrame,
  type VideoFrameEvent,
} from "@livekit/rtc-node";
import type { Frame } from "@animus/brain";

const MAX_SIDE = 768;
const JPEG_QUALITY = 80;

// sharp encodeert de JPEG: @livekit/agents heeft sharp al transitief nodig, en zijn eigen serializeImage
// levert enkel PNG.
export async function encodeFrame(rgba: Uint8Array, width: number, height: number): Promise<Frame> {
  const buffer = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { data: new Uint8Array(buffer), mediaType: "image/jpeg" };
}

/** Bewaart het laatste camerabeeld van de room; levert er een JPEG van op aanvraag (ADR-0018). */
export function createFrameSource(room: Room): { latest(): Promise<Frame | null>; dispose(): void } {
  // Via de reader sluiten: cancel() op de vergrendelde stream zelf rejectt en lekt dan de native stream.
  let reader: ReadableStreamDefaultReader<VideoFrameEvent> | undefined;
  let lastFrame: VideoFrame | undefined;
  let muted = false;

  function closeStream(): void {
    reader?.cancel().catch(() => {});
    reader = undefined;
    lastFrame = undefined;
  }

  function openStream(track: RemoteTrack): void {
    closeStream();
    const own = new VideoStream(track).getReader();
    reader = own;
    // ponytail: elk frame wordt gelezen (ook als niemand kijkt), maar pas bij latest() geconverteerd; throttlen als CPU ooit telt.
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await own.read();
          if (done || reader !== own) return; // gesloten, of een nieuwere stream heeft deze vervangen
          lastFrame = value.frame;
        }
      } catch {
        // stream gesloten (closeStream/dispose): geen fout.
      }
    })();
  }

  const onSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, _participant: RemoteParticipant): void => {
    if (track.kind !== TrackKind.KIND_VIDEO) return;
    muted = publication.muted ?? false;
    openStream(track);
  };
  const onUnsubscribed = (track: RemoteTrack): void => {
    if (track.kind !== TrackKind.KIND_VIDEO) return;
    closeStream();
  };
  // livekit-client's setCameraEnabled(false) mute't de track meestal i.p.v. te unpublishen; een slapende
  // Dynimo mag nooit het laatste frame van de vorige sessie leveren (privacy).
  const onMuted = (publication: TrackPublication, _participant: Participant): void => {
    if (publication.kind !== TrackKind.KIND_VIDEO) return;
    muted = true;
    lastFrame = undefined;
  };
  const onUnmuted = (publication: TrackPublication, _participant: Participant): void => {
    if (publication.kind !== TrackKind.KIND_VIDEO) return;
    muted = false;
  };

  room.on(RoomEvent.TrackSubscribed, onSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
  room.on(RoomEvent.TrackMuted, onMuted);
  room.on(RoomEvent.TrackUnmuted, onUnmuted);

  return {
    async latest() {
      if (muted || !lastFrame) return null;
      const rgba = lastFrame.convert(VideoBufferType.RGBA);
      return encodeFrame(rgba.data, rgba.width, rgba.height);
    },
    dispose() {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      closeStream();
    },
  };
}
