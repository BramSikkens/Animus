import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useDataChannel,
  useTrackVolume,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { DISPLAY_STATES, DISPLAY_TOPIC, isDisplayState, type DisplayState } from "@animus/brain/display";
import { EMOTION_TOPIC, EMOTIONS, isEmotion, type EmotionMessage } from "@animus/brain/emotion";
import { doodleActive } from "./face/doodle.js";
import { isSoundKind, SOUND_TOPIC } from "@animus/brain/sound";
import { clipUrl } from "./sound.js";
import { Face } from "./face/Face.js";

type TokenSession = { serverUrl: string; token: string };
// De gezichtje-app tekent voorlopig enkel de dominante emotie; de volledige vector (balken) volgt in #55.
type EmotionState = Pick<EmotionMessage, "emotion" | "intensity">;

const NEUTRAL_STATE: EmotionState = { emotion: "neutraal", intensity: 0 };
const DEFAULT_DISPLAY: DisplayState = "wakker";
// Eigen lokale idle-drempel voor de doodle-modus, los van de stiltedrempel van Reflectie in de agent.
const DOODLE_IDLE_MS = 5 * 60 * 1000;
// ?doodle=<seconden> overschrijft de drempel om handmatig te testen.
function doodleThresholdMs(): number {
  const seconds = Number(new URLSearchParams(window.location.search).get("doodle"));
  return seconds > 0 ? seconds * 1000 : DOODLE_IDLE_MS;
}

const STATUS_LABELS: Record<ConnectionState, string> = {
  [ConnectionState.Disconnected]: "niet verbonden",
  [ConnectionState.Connecting]: "verbinden…",
  [ConnectionState.Connected]: "verbonden",
  [ConnectionState.Reconnecting]: "opnieuw verbinden…",
  [ConnectionState.SignalReconnecting]: "opnieuw verbinden…",
};

function ConnectionStatus() {
  const state = useConnectionState();
  return <p className="status">{STATUS_LABELS[state]}</p>;
}

// Decodeert emotie-events van de agent (EmotionMessage op EMOTION_TOPIC) en
// valideert ze, zodat een onverwacht/kapot bericht de face-app niet laat crashen.
function EmotionListener({ onEmotion }: { onEmotion: (state: EmotionState) => void }) {
  useDataChannel(EMOTION_TOPIC, (msg) => {
    // Enkel de agent mag het gezicht aansturen, niet een andere deelnemer in de room.
    if (!msg.from?.isAgent) return;
    try {
      const payload: unknown = JSON.parse(new TextDecoder().decode(msg.payload));
      if (
        payload !== null &&
        typeof payload === "object" &&
        "emotion" in payload &&
        "intensity" in payload &&
        isEmotion(payload.emotion) &&
        typeof payload.intensity === "number"
      ) {
        onEmotion({ emotion: payload.emotion, intensity: payload.intensity });
      } else {
        console.error("Emotie-event heeft onverwachte vorm:", payload);
      }
    } catch (error) {
      console.error("Emotie-event kon niet verwerkt worden:", error instanceof Error ? error.message : error);
    }
  });
  return null;
}

// Decodeert weergavetoestand-berichten van de agent (DisplayMessage op DISPLAY_TOPIC), met dezelfde validatie.
function DisplayListener({ onDisplay }: { onDisplay: (state: DisplayState) => void }) {
  useDataChannel(DISPLAY_TOPIC, (msg) => {
    if (!msg.from?.isAgent) return;
    try {
      const payload: unknown = JSON.parse(new TextDecoder().decode(msg.payload));
      if (payload !== null && typeof payload === "object" && "state" in payload && isDisplayState(payload.state)) {
        onDisplay(payload.state);
      } else {
        console.error("Display-event heeft onverwachte vorm:", payload);
      }
    } catch (error) {
      console.error("Display-event kon niet verwerkt worden:", error instanceof Error ? error.message : error);
    }
  });
  return null;
}

// Leest het volume van de agent-audiotrack (buiten de room is er geen track, dus volume 0).
function MouthVolumeListener({ onVolume }: { onVolume: (volume: number) => void }) {
  const { audioTrack } = useVoiceAssistant();
  const volume = useTrackVolume(audioTrack);
  // Op 2 decimalen afgerond: beperkt het aantal re-renders van het gezicht.
  const rounded = Math.round(volume * 100) / 100;
  useEffect(() => onVolume(rounded), [rounded, onVolume]);
  return null;
}

// Speelt bij een sound-event (SoundMessage op SOUND_TOPIC) een vooraf opgenomen clip af; niet tijdens slapend/reflecterend.
function SoundListener({ display, onSound }: { display: DisplayState; onSound: () => void }) {
  useDataChannel(SOUND_TOPIC, (msg) => {
    if (msg.from?.isAgent) onSound();
    if (!msg.from?.isAgent || display === "slapend" || display === "reflecterend") return;
    try {
      const payload: unknown = JSON.parse(new TextDecoder().decode(msg.payload));
      if (payload !== null && typeof payload === "object" && "kind" in payload && isSoundKind(payload.kind)) {
        // Autoplay is ontgrendeld door StartAudio; een geweigerde play() is geen fout voor de sessie.
        void new Audio(clipUrl(payload.kind)).play().catch(() => {});
      } else {
        console.error("Sound-event heeft onverwachte vorm:", payload);
      }
    } catch (error) {
      console.error("Sound-event kon niet verwerkt worden:", error instanceof Error ? error.message : error);
    }
  });
  return null;
}

// ?debug: paneel om het gezicht handmatig of met Playwright te sturen, zonder LiveKit.
function DebugPanel({
  state,
  onChange,
  display,
  onDisplayChange,
}: {
  state: EmotionState;
  onChange: (state: EmotionState) => void;
  display: DisplayState;
  onDisplayChange: (display: DisplayState) => void;
}) {
  return (
    <div className="debug-panel">
      {DISPLAY_STATES.map((option) => (
        <button key={option} type="button" aria-pressed={display === option} onClick={() => onDisplayChange(option)}>
          {option}
        </button>
      ))}
      {EMOTIONS.map((emotion) => (
        <button
          key={emotion}
          type="button"
          aria-pressed={state.emotion === emotion}
          onClick={() => onChange({ ...state, emotion })}
        >
          {emotion}
        </button>
      ))}
      <label>
        intensiteit {state.intensity.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.intensity}
          onChange={(event) => onChange({ ...state, intensity: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<TokenSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emotionState, setEmotionState] = useState<EmotionState>(NEUTRAL_STATE);
  const [displayState, setDisplayState] = useState<DisplayState>(DEFAULT_DISPLAY);
  const [mouthVolume, setMouthVolume] = useState(0);
  const [doodle, setDoodle] = useState(false);
  const lastActivity = useRef(Date.now());
  const thresholdMs = useMemo(doodleThresholdMs, []);
  const debug = useMemo(() => new URLSearchParams(window.location.search).has("debug"), []);

  // Elke uiting van de agent (datachannel-bericht) of wakker-achtige toestand zet het gezichtje meteen terug.
  const touch = useCallback(() => {
    lastActivity.current = Date.now();
    setDoodle(false);
  }, []);
  const onEmotion = useCallback((state: EmotionState) => { touch(); setEmotionState(state); }, [touch]);
  const onDisplay = useCallback((state: DisplayState) => { touch(); setDisplayState(state); }, [touch]);

  // wakker is de enige "stille" toestand; luisterend/spreekt tellen als activiteit, slapend/reflecterend blokkeren de doodle.
  useEffect(() => {
    if (displayState !== "wakker") touch();
  }, [displayState, touch]);

  useEffect(() => {
    const id = setInterval(
      () => setDoodle(doodleActive({ idleMs: Date.now() - lastActivity.current, thresholdMs, display: displayState })),
      1000,
    );
    return () => clearInterval(id);
  }, [thresholdMs, displayState]);

  async function start(): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/token");
      if (!response.ok) throw new Error(`Token ophalen mislukt (${response.status})`);
      setSession((await response.json()) as TokenSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function stop(): void {
    setSession(null);
    setEmotionState(NEUTRAL_STATE);
    setDisplayState(DEFAULT_DISPLAY);
    setMouthVolume(0);
  }

  return (
    <>
      <Face doodle={doodle} display={displayState} emotion={emotionState.emotion} intensity={emotionState.intensity} mouthVolume={mouthVolume} />

      <main className="screen">
        {!session ? (
          <>
            <button type="button" onClick={() => void start()}>
              Praat met Animus
            </button>
            {error && <p className="error">{error}</p>}
          </>
        ) : (
          <LiveKitRoom
            serverUrl={session.serverUrl}
            token={session.token}
            audio
            connect
            onDisconnected={stop}
            onError={(err) => setError(err.message)}
          >
            <EmotionListener onEmotion={onEmotion} />
            <DisplayListener onDisplay={onDisplay} />
            <MouthVolumeListener onVolume={setMouthVolume} />
            <SoundListener display={displayState} onSound={touch} />
            <ConnectionStatus />
            <RoomAudioRenderer />
            <StartAudio label="Zet geluid aan" />
            <button type="button" onClick={stop}>
              Stop
            </button>
            {error && <p className="error">{error}</p>}
          </LiveKitRoom>
        )}
      </main>

      {debug && (
        <DebugPanel
          state={emotionState}
          onChange={setEmotionState}
          display={displayState}
          onDisplayChange={setDisplayState}
        />
      )}
    </>
  );
}
