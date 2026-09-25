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

const GRAB_TIMEOUT_MS = 1000;

/**
 * Houdt de camera-track van de room bij en pakt pas bij Kijken één beeld als JPEG (ADR-0018). Geen continue stream:
 * elk beeld (~30/s) binnenlezen kostte GC-pauzes op de agent-loop terwijl er zelden gekeken wordt.
 */
export function createFrameSource(room: Room): { latest(): Promise<Frame | null>; dispose(): void } {
  let track: RemoteTrack | undefined;
  let muted = false;
  // Enkel events van de actieve track tellen: een late unsubscribe/mute van een herladen tab mag de nieuwe niet wissen.
  let activeSid: string | undefined;

  // Opent kort een eigen stream, neemt het eerste beeld en sluit via de reader (cancel() op de vergrendelde
  // stream zelf rejectt en lekt dan de native stream). Geen beeld binnen de timeout: null.
  async function grab(from: RemoteTrack): Promise<VideoFrame | null> {
    const reader = new VideoStream(from).getReader();
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), GRAB_TIMEOUT_MS)));
      const first = reader.read().then(({ done, value }) => (done ? null : value.frame));
      return await Promise.race([first, timeout]);
    } finally {
      clearTimeout(timer);
      reader.cancel().catch(() => {});
    }
  }

  const onSubscribed = (subscribed: RemoteTrack, publication: RemoteTrackPublication, _participant: RemoteParticipant): void => {
    if (subscribed.kind !== TrackKind.KIND_VIDEO) return;
    activeSid = publication.sid;
    muted = publication.muted ?? false;
    track = subscribed;
  };
  const onUnsubscribed = (_track: RemoteTrack, publication: RemoteTrackPublication): void => {
    if (publication.sid !== activeSid) return;
    track = undefined;
  };
  // livekit-client's setCameraEnabled(false) mute't de track meestal i.p.v. te unpublishen: een slapende Dynimo
  // mag dan niets zien (privacy).
  const onMuted = (publication: TrackPublication, _participant: Participant): void => {
    if (publication.sid === activeSid) muted = true;
  };
  const onUnmuted = (publication: TrackPublication, _participant: Participant): void => {
    if (publication.sid === activeSid) muted = false;
  };

  room.on(RoomEvent.TrackSubscribed, onSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
  room.on(RoomEvent.TrackMuted, onMuted);
  room.on(RoomEvent.TrackUnmuted, onUnmuted);

  return {
    async latest() {
      if (muted || !track) return null;
      const frame = await grab(track);
      if (!frame || muted) return null; // intussen gemute: niets tonen
      const rgba = frame.convert(VideoBufferType.RGBA);
      return encodeFrame(rgba.data, rgba.width, rgba.height);
    },
    dispose() {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      track = undefined;
    },
  };
}
