import { AudioStream, RoomEvent, TrackSource, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication, type Room } from "@livekit/rtc-node";
import { createSpeechAudioBuffer } from "./speech-audio-buffer.js";

const SAMPLE_RATE = 16_000; // wat sherpa-onnx verwacht (identify/enroll)
const PREROLL_MS = 500;
const MAX_BUFFER_MS = 10_000;

/**
 * Houdt de microfoon-audio van de "geluisterde" deelnemer bij als PCM voor stemherkenning (#92). Buffert enkel
 * terwijl `isSpeaking()` waar is (plus een korte pre-roll, zie speech-audio-buffer.ts). Geen adapter-tests
 * (ADR-0020-ticket): dun, handmatig geverifieerd; wel getypecheckt.
 */
export function createSpeakerAudio(room: Room, isSpeaking: () => boolean): { listenTo(identity: string): void; drain(): Int16Array; dispose(): void } {
  const buffer = createSpeechAudioBuffer({
    prerollSamples: Math.round((SAMPLE_RATE * PREROLL_MS) / 1000),
    maxSamples: Math.round((SAMPLE_RATE * MAX_BUFFER_MS) / 1000),
  });
  let targetIdentity: string | undefined;
  let stream: AudioStream | undefined;

  async function readAll(current: AudioStream): Promise<void> {
    try {
      for await (const frame of current) {
        if (stream !== current) return; // ondertussen vervangen (nieuwe luisterdeelnemer): deze stream negeren
        buffer.push(frame.data, isSpeaking());
      }
    } catch (error) {
      console.warn("Stemaudio lezen faalde:", error instanceof Error ? error.message : error);
    }
  }

  function attach(track: RemoteTrack): void {
    const previous = stream;
    const current = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 });
    stream = current;
    void readAll(current);
    if (previous) void previous.cancel().catch(() => {});
  }

  function micTrackOf(participant: RemoteParticipant): RemoteTrack | undefined {
    for (const publication of participant.trackPublications.values()) {
      if (publication.source === TrackSource.SOURCE_MICROPHONE && publication.track) return publication.track as RemoteTrack;
    }
    return undefined;
  }

  const onSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    if (publication.source !== TrackSource.SOURCE_MICROPHONE || participant.identity !== targetIdentity) return;
    attach(track);
  };
  room.on(RoomEvent.TrackSubscribed, onSubscribed);

  return {
    listenTo(identity) {
      targetIdentity = identity;
      const participant = room.remoteParticipants.get(identity);
      const track = participant && micTrackOf(participant);
      if (track) attach(track);
    },
    drain: () => buffer.drain(),
    dispose() {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      if (stream) void stream.cancel().catch(() => {});
      stream = undefined;
    },
  };
}
