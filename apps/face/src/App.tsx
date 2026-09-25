import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRemoteParticipants,
  useTranscriptions,
  useTrackVolume,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ConnectionState, type LocalAudioTrack } from "livekit-client";
import { DISPLAY_STATES, DISPLAY_TOPIC, isDisplayState, type DisplayState } from "@animus/brain/display";
import { GALLERY_TOPIC, justWoken, parseGalleryMessage, screenFor, selectionLost, type GalleryBeing, type GalleryGrave, type GalleryMessage } from "@animus/brain/gallery";
import { Gallery, useSendCommand } from "./Gallery.js";
import { EMOTION_TOPIC, EMOTIONS, isEmotion, type Emotion, type EmotionMessage } from "@animus/brain/emotion";
import { doodleActive } from "./face/doodle.js";
import { isSoundKind, SOUND_TOPIC } from "@animus/brain/sound";
import { clipUrl } from "./sound.js";
import { Face } from "./face/Face.js";
import { voiceReaction, type VoiceReaction } from "./face/voice-reaction.js";

const VOICE_WINDOW = 20; // samples van 100ms
const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2000;
const AGENT_CHECK_MS = 5000;
import { emotionBarGroups } from "./emotion-bars.js";
import { FALLBACK_BASE } from "@animus/brain/mood";

type TokenSession = { serverUrl: string; token: string };
// `values` (de volledige vector) voedt de balken; ontbreekt hij (debugpaneel), dan tonen we geen balken.
type EmotionState = Pick<EmotionMessage, "emotion" | "intensity"> & { values?: Record<Emotion, number> };

const NEUTRAL_STATE: EmotionState = { emotion: FALLBACK_BASE, intensity: 0 };
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
        const values = "values" in payload ? payload.values : undefined;
        const valid =
          values !== null && typeof values === "object" && EMOTIONS.every((e) => typeof (values as Record<string, unknown>)[e] === "number");
        onEmotion({
          emotion: payload.emotion,
          intensity: payload.intensity,
          values: valid ? (values as Record<Emotion, number>) : undefined,
        });
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
function DisplayListener({ onDisplay, onName }: { onDisplay: (state: DisplayState) => void; onName: (name: string | null) => void }) {
  useDataChannel(DISPLAY_TOPIC, (msg) => {
    if (!msg.from?.isAgent) return;
    try {
      const payload: unknown = JSON.parse(new TextDecoder().decode(msg.payload));
      if (payload !== null && typeof payload === "object" && "state" in payload && isDisplayState(payload.state)) {
        onDisplay(payload.state);
        if ("name" in payload && (typeof payload.name === "string" || payload.name === null)) onName(payload.name);
      } else {
        console.error("Display-event heeft onverwachte vorm:", payload);
      }
    } catch (error) {
      console.error("Display-event kon niet verwerkt worden:", error instanceof Error ? error.message : error);
    }
  });
  return null;
}

// Decodeert Galerij-berichten van de agent (GalleryMessage op GALLERY_TOPIC); oudere berichten zonder `graves` blijven geldig.
function GalleryListener({ onGallery }: { onGallery: (message: GalleryMessage) => void }) {
  useDataChannel(GALLERY_TOPIC, (msg) => {
    if (!msg.from?.isAgent) return;
    try {
      const message = parseGalleryMessage(JSON.parse(new TextDecoder().decode(msg.payload)));
      if (message) onGallery(message);
      else console.error("Galerij-event heeft onverwachte vorm");
    } catch (error) {
      console.error("Galerij-event kon niet verwerkt worden:", error instanceof Error ? error.message : error);
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

// Volume van de eigen microfoon (lokale track, geen extra netwerkverkeer) -> stemreactie in een ref; één interval van 100ms.
function VoiceReactionListener({ reaction }: { reaction: { current: VoiceReaction } }) {
  const { microphoneTrack } = useLocalParticipant();
  const volume = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);
  const latest = useRef(0);
  latest.current = volume;
  useEffect(() => {
    const samples: number[] = [];
    const id = setInterval(() => {
      samples.push(latest.current);
      if (samples.length > VOICE_WINDOW) samples.shift();
      reaction.current = voiceReaction({ samples, baseline: 0 });
    }, 100);
    return () => clearInterval(id);
  }, [reaction]);
  return null;
}

// Laatste transcriptie van de eigen microfoon (agent publiceert die op lk.transcription); voedt de micro-expressies.
function UserTextListener({ onText }: { onText: (text: string) => void }) {
  const { localParticipant } = useLocalParticipant();
  const last = useTranscriptions({ participantIdentities: [localParticipant.identity] }).at(-1)?.text;
  useEffect(() => { if (last) onText(last); }, [last, onText]);
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

// Geen agent in de room (hij is herstart terwijl deze tab verbonden bleef): vraag de dev-server er een te sturen.
function AgentWatchdog() {
  const hasAgent = useRemoteParticipants().some((p) => p.isAgent);
  useEffect(() => {
    if (hasAgent) return;
    const id = setInterval(() => void fetch("/api/agent", { method: "POST" }).catch(() => {}), AGENT_CHECK_MS);
    return () => clearInterval(id);
  }, [hasAgent]);
  return null;
}

// LiveKitRoom zet `audio` alleen bij het verbinden; we verbinden al bij het laden, dus de microfoon volgt de keuze hier.
function MicControl({ enabled, onError }: { enabled: boolean; onError: (message: string) => void }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    localParticipant.setMicrophoneEnabled(enabled).catch(() => onError("Microfoon niet beschikbaar; controleer de permissie."));
  }, [enabled, localParticipant, onError]);
  return null;
}

// Camera enkel aan als een Dynimo wakker is en zijn gezicht toont (ADR-0018); geen videobeeld in deze UI, enkel
// de publicatie voor de agent.
function CameraControl({ enabled, onError }: { enabled: boolean; onError: (message: string) => void }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    localParticipant.setCameraEnabled(enabled).catch(() => onError("Camera niet beschikbaar; controleer de permissie."));
  }, [enabled, localParticipant, onError]);
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

// Galerij / wakker-worden / Terug-knop; leeft binnen de room omdat wake/sleep via de datachannel gaan.
function Screens({ view, onSelect, onBack }: { view: ReturnType<typeof screenFor>; onSelect: (id: number) => void; onBack: () => void }) {
  const send = useSendCommand();
  if (view.screen === "galerij") {
    return (
      <Gallery
        beings={view.beings}
        graves={view.graves}
        onCommand={send}
        onSelect={(being) => {
          if (!being.awake) send({ type: "wake", id: being.id });
          onSelect(being.id);
        }}
      />
    );
  }
  if (view.screen !== "wakker-worden" && view.screen !== "gezicht") return null;
  return (
    <>
      {view.screen === "wakker-worden" && <p className="status">Wakker worden…</p>}
      <button type="button" onClick={() => { send({ type: "sleep", id: view.being.id }); onBack(); }}>
        Terug
      </button>
    </>
  );
}

export function App() {
  const [session, setSession] = useState<TokenSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emotionState, setEmotionState] = useState<EmotionState>(NEUTRAL_STATE);
  const [displayState, setDisplayState] = useState<DisplayState>(DEFAULT_DISPLAY);
  const [name, setName] = useState<string | null>(null);
  const [beings, setBeings] = useState<GalleryBeing[] | null>(null);
  const [graves, setGraves] = useState<GalleryGrave[]>([]);
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const attempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sawAwake = useRef(false);
  const [mouthVolume, setMouthVolume] = useState(0);
  const [doodle, setDoodle] = useState(false);
  const [userText, setUserText] = useState<string>();
  const voice = useRef<VoiceReaction>({ startle: 0, lean: 0, alert: 0 });
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

  async function connect(): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/token");
      if (!response.ok) throw new Error(`Token ophalen mislukt (${response.status})`);
      setSession((await response.json()) as TokenSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Direct verbinden (zonder microfoon); ?debug toont het gezicht zonder LiveKit.
  useEffect(() => {
    if (!debug) void connect();
    return () => clearTimeout(retryTimer.current);
  }, [debug]);

  function reset(): void {
    setSession(null);
    setConnected(false);
    setSelectedId(null);
    setEmotionState(NEUTRAL_STATE);
    setDisplayState(DEFAULT_DISPLAY);
    setName(null);
    setBeings(null);
    setGraves([]);
    setMouthVolume(0);
    setUserText(undefined);
  }

  // Verbindingsverlies: enkele keren automatisch opnieuw, daarna de foutmelding met 'Opnieuw proberen'.
  function onDisconnected(): void {
    reset();
    if (attempts.current++ < MAX_RECONNECTS) retryTimer.current = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    else setError("Verbinding verbroken");
  }

  function retry(): void {
    attempts.current = 0;
    void connect();
  }

  // Ergens gewekt (dashboard, Wek-knop) terwijl we in de Galerij staan: open zijn gezicht, zodat de microfoon aangaat.
  const prevBeings = useRef<GalleryBeing[] | null>(null);
  useEffect(() => {
    const woken = beings && justWoken({ before: prevBeings.current, after: beings });
    prevBeings.current = beings;
    if (woken != null && selectedId === null) {
      sawAwake.current = false;
      setMicError(null);
      setSelectedId(woken);
    }
  }, [beings, selectedId]);

  // Gekozen Dynimo elders slapend gelegd (of verdwenen): terug naar de Galerij.
  useEffect(() => {
    if (selectedId === null || !beings) return;
    const being = beings.find((b) => b.id === selectedId);
    if (being?.awake) sawAwake.current = true;
    if (selectionLost({ selectedId, beings, sawAwake: sawAwake.current })) setSelectedId(null);
  }, [beings, selectedId]);

  const view = screenFor({ connected, beings, graves, selectedId });

  return (
    <>
      {(debug || view.screen === "gezicht") && <>
      <Face doodle={doodle} display={displayState} emotion={emotionState.emotion} intensity={emotionState.intensity} mouthVolume={mouthVolume} values={emotionState.values} lastUserText={userText} voice={voice} />

      {name && <p className="dynimo-name">{name}</p>}
      {emotionState.values && (
        <ul className="emotion-bars" aria-label="Emoties">
          {emotionBarGroups(emotionState.values).map((group) => (
            <li key={group[0]!.emotion}>
              {group.map(({ emotion, value }) => (
                <div key={emotion} className="item">
                  <span>{emotion}</span>
                  <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
                    <div style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      </>}

      <main className="screen">
        {!session ? (
          error ? (
            <>
              <p className="error">{error}</p>
              <button type="button" onClick={retry}>
                Opnieuw proberen
              </button>
            </>
          ) : (
            !debug && <p className="status">Verbinden…</p>
          )
        ) : (
          <LiveKitRoom
            serverUrl={session.serverUrl}
            token={session.token}
            connect
            onConnected={() => { attempts.current = 0; setConnected(true); }}
            onDisconnected={onDisconnected}
            onError={(err) => setError(err.message)}
            onMediaDeviceFailure={() => setMicError("Microfoon niet beschikbaar; controleer de permissie.")}
          >
            <EmotionListener onEmotion={onEmotion} />
            <DisplayListener onDisplay={onDisplay} onName={setName} />
            <UserTextListener onText={setUserText} />
            <MouthVolumeListener onVolume={setMouthVolume} />
            <VoiceReactionListener reaction={voice} />
            <GalleryListener onGallery={(message) => { setBeings(message.beings); setGraves(message.graves); }} />
            <SoundListener display={displayState} onSound={touch} />
            <AgentWatchdog />
            <MicControl enabled={selectedId !== null} onError={setMicError} />
            <CameraControl enabled={view.screen === "gezicht" && displayState !== "slapend"} onError={setMicError} />
            <ConnectionStatus />
            <RoomAudioRenderer />
            <StartAudio label="Zet geluid aan" />
            <Screens
              view={view}
              onSelect={(id) => { sawAwake.current = false; setMicError(null); setSelectedId(id); }}
              onBack={() => setSelectedId(null)}
            />
            {micError && <p className="error">{micError}</p>}
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
