import { useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, StartAudio, useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

// Nog geen gezicht (dat komt in een later ticket): enkel de spraakverbinding.
type TokenSession = { serverUrl: string; token: string };

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

export function App() {
  const [session, setSession] = useState<TokenSession | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }

  if (!session) {
    return (
      <main className="screen">
        <h1>Animus</h1>
        <button onClick={() => void start()}>Praat met Animus</button>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={session.serverUrl}
      token={session.token}
      audio
      connect
      onDisconnected={stop}
      onError={(err) => setError(err.message)}
    >
      <main className="screen">
        <h1>Animus</h1>
        <ConnectionStatus />
        <RoomAudioRenderer />
        <StartAudio label="Zet geluid aan" />
        <button onClick={stop}>Stop</button>
        {error && <p className="error">{error}</p>}
      </main>
    </LiveKitRoom>
  );
}
