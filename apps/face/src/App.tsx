import { useMemo, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, StartAudio, useConnectionState, useDataChannel } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { EMOTION_TOPIC, EMOTIONS, isEmotion, type EmotionMessage } from "@animus/brain/emotion";
import { Face } from "./face/Face.js";

type TokenSession = { serverUrl: string; token: string };
type EmotionState = EmotionMessage;

const NEUTRAL_STATE: EmotionState = { emotion: "neutraal", intensity: 0 };

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

// ?debug: paneel om het gezicht handmatig of met Playwright te sturen, zonder LiveKit.
function DebugPanel({ state, onChange }: { state: EmotionState; onChange: (state: EmotionState) => void }) {
  return (
    <div className="debug-panel">
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
  const debug = useMemo(() => new URLSearchParams(window.location.search).has("debug"), []);

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
  }

  return (
    <>
      <Face emotion={emotionState.emotion} intensity={emotionState.intensity} />

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
            <EmotionListener onEmotion={setEmotionState} />
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

      {debug && <DebugPanel state={emotionState} onChange={setEmotionState} />}
    </>
  );
}
