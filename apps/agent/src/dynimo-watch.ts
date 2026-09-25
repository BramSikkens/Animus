import postgres from "postgres";
import { STATE_CHANNEL, type Brain } from "@animus/brain";
import type { DisplayState } from "@animus/brain/display";
import { displayMoodOfRow, type Mood } from "@animus/brain/mood";

export type DynimoState = {
  /** Identiteit van de huidige Wakker-generatie; verandert bij wisselen, slapen of gedood worden. */
  key: string;
  display: DisplayState;
  /** De effectieve Stemming van de wakkere Dynimo op het moment van lezen; null als niemand wakker is. */
  mood: Mood | null;
  /** Naam van de wakkere Dynimo; null als niemand wakker is. */
  name: string | null;
  /** Opgeslagen TTS-stem van de wakkere Dynimo; null = default (of niemand wakker). */
  voice: string | null;
  /** Expressiviteit-as van de wakkere Dynimo (0.5 = neutraal, ook als niemand wakker is). */
  expressiveness: number;
};

/** Leest vers uit de database (ook de Stemming, die met de tijd uitdooft). */
export async function readState(brain: Brain): Promise<DynimoState> {
  const awake = (await brain.list()).find((dynimo) => dynimo.awakeSince);
  return awake
    ? { key: `${awake.id}:${awake.awakeSince!.getTime()}`, display: "wakker", mood: displayMoodOfRow(awake, new Date()), name: awake.name, voice: awake.voice, expressiveness: awake.axisExpressiveness }
    : { key: "none", display: "slapend", mood: null, name: null, voice: null, expressiveness: 0.5 };
}

/**
 * Luistert (Postgres LISTEN/NOTIFY) naar toestandswijzigingen van de Dynimo's en roept `onChange` aan
 * zodra de wakkere Dynimo verandert. Eigen connectie, los van de brain-verbinding.
 */
export async function watchDynimos(options: {
  databaseUrl: string;
  brain: Brain;
  onChange: (state: DynimoState) => void;
  /** Een Stemming is van buitenaf gezet (dashboard-override, payload "mood:<id>"): ververs enkel het gezichtje. */
  onMood?: () => void;
  /** De stem van een Dynimo is gewijzigd (dashboard, payload "voice:<id>"). */
  onVoice?: () => void;
  /** Elke toestandsmelding behalve Stemming (wakker/slapend/genesis/gedood/stem): ververst bv. de Galerij. */
  onNotify?: () => void;
}): Promise<{ current: () => DynimoState; close: () => Promise<void> }> {
  const listener = postgres(options.databaseUrl, { max: 1, onnotice: () => {} });
  let last: DynimoState | undefined;
  // Serialiseren: snel opeenvolgende meldingen mogen elkaar niet inhalen.
  let queue: Promise<void> = Promise.resolve();

  // Leest de toestand en meldt een verandering t.o.v. de vorige bekende (de eerste lezing zet enkel de basis).
  function check(): Promise<void> {
    queue = queue.then(async () => {
      try {
        const next = await readState(options.brain);
        if (next.key === last?.key) return;
        const previous = last;
        last = next;
        if (previous) options.onChange(next);
      } catch (error) {
        console.error("Toestand van de Dynimo's lezen faalde:", error instanceof Error ? error.message : error);
      }
    });
    return queue;
  }

  // Eerst luisteren, dán lezen: een wissel tussen lezen en luisteren gaat anders verloren. `onlisten` draait
  // bij elke (her)verbinding, zodat meldingen tijdens een onderbreking alsnog opgemerkt worden.
  await listener.listen(
    STATE_CHANNEL,
    (payload: string) => {
      if (payload.startsWith("mood:")) return options.onMood?.();
      options.onNotify?.();
      return payload.startsWith("voice:") ? options.onVoice?.() : void check();
    },
    check,
  );
  await check();

  return {
    current: () => last!,
    close: () => listener.end(),
  };
}
