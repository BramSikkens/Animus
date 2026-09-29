import postgres from "postgres";
import { STATE_CHANNEL, STATE_PREFIXES, type Animus, type Dynimo } from "@animus/core";
import type { DisplayState } from "@animus/core/display";
import { displayMoodOfRow, type Mood } from "@animus/core/mood";

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
  /** Volledige rij van de wakkere Dynimo (kenmerken, #105); null als niemand wakker is. */
  row: Dynimo | null;
};

/** Leest vers uit de database (ook de Stemming, die met de tijd uitdooft). */
export async function readState(animus: Animus): Promise<DynimoState> {
  const awake = (await animus.list()).find((dynimo) => dynimo.awakeSince);
  return awake
    ? { key: `${awake.id}:${awake.awakeSince!.getTime()}`, display: "wakker", mood: displayMoodOfRow(awake, new Date()), name: awake.name, voice: awake.voice, expressiveness: awake.axisExpressiveness, row: awake }
    : { key: "none", display: "slapend", mood: null, name: null, voice: null, expressiveness: 0.5, row: null };
}

/** Handlers voor `routeNotifyPayload`, hergebruikt als de STATE_CHANNEL-opties van `watchDynimos`. */
export type NotifyHandlers = {
  /** Niet in `watchDynimos`' eigen opties: enkel `routeNotifyPayload` gebruikt dit (elke overige melding). */
  check: () => void;
  /** Een Stemming is van buitenaf gezet (dashboard-override, payload "mood:<id>"): ververs enkel het gezichtje. */
  onMood?: () => void;
  /** De stem van een Dynimo is gewijzigd (dashboard, payload "voice:<id>"). */
  onVoice?: () => void;
  /** Personen zijn samengevoegd/verwijderd/opnieuw geleerd (dashboard, payload "persons:", #95): biometrie is verouderd; ververst ook de kenmerken, want een naamswijziging na samenvoegen moet zichtbaar worden (#111). */
  onPersons?: () => void;
  /** Assen/Verstand/archetype/Vertrouwdheid gewijzigd (dashboard, payload "kenmerken:<id>" of "kenmerken:"): ververs enkel de kenmerken. */
  onKenmerken?: () => void;
  /** Elke toestandsmelding behalve Stemming/kenmerken (wakker/slapend/genesis/gedood/stem/personen): ververst bv. de Galerij. */
  onNotify?: () => void;
  /** Reflectie-voortgang van de worker (#125, payload "reflectie:start:<id>"/"reflectie:einde:<id>"): geen check()/onNotify erbij. */
  onReflectie?: (phase: "start" | "einde", dynimoId: number) => void;
};

/**
 * Bepaalt, puur op de payload-tekst, welke handler(s) een STATE_CHANNEL-melding oproept. Losstaand van
 * `watchDynimos` getest, zonder een echte Postgres-verbinding nodig te hebben.
 */
export function routeNotifyPayload(payload: string, handlers: NotifyHandlers): void {
  // Zoals "mood:": enkel het gezichtje ververst zijn kenmerken, geen wissel of Galerij-update als bijwerking.
  if (payload.startsWith(STATE_PREFIXES.mood)) return void handlers.onMood?.();
  if (payload.startsWith(STATE_PREFIXES.reflectie)) {
    const [phase, idText] = payload.slice(STATE_PREFIXES.reflectie.length).split(":");
    const dynimoId = Number(idText);
    if ((phase === "start" || phase === "einde") && Number.isFinite(dynimoId)) return void handlers.onReflectie?.(phase, dynimoId);
  }
  if (payload.startsWith(STATE_PREFIXES.kenmerken)) return void handlers.onKenmerken?.();
  handlers.onNotify?.();
  if (payload.startsWith(STATE_PREFIXES.voice)) return void handlers.onVoice?.();
  if (payload.startsWith(STATE_PREFIXES.persons)) {
    handlers.onPersons?.();
    // Naamswijziging na samenvoegen (#111): de Vertrouwdheid-naam in het gezichtje kan verouderd zijn.
    return void handlers.onKenmerken?.();
  }
  return void handlers.check();
}

/**
 * Luistert (Postgres LISTEN/NOTIFY) naar toestandswijzigingen van de Dynimo's en roept `onChange` aan
 * zodra de wakkere Dynimo verandert. Eigen connectie, los van de Animus-verbinding.
 */
export async function watchDynimos(
  options: Omit<NotifyHandlers, "check"> & {
    databaseUrl: string;
    animus: Animus;
    onChange: (state: DynimoState) => void;
  },
): Promise<{ current: () => DynimoState; close: () => Promise<void> }> {
  const listener = postgres(options.databaseUrl, { max: 1, onnotice: () => {} });
  let last: DynimoState | undefined;
  // Serialiseren: snel opeenvolgende meldingen mogen elkaar niet inhalen.
  let queue: Promise<void> = Promise.resolve();

  // Leest de toestand en meldt een verandering t.o.v. de vorige bekende (de eerste lezing zet enkel de basis).
  function check(): Promise<void> {
    queue = queue.then(async () => {
      try {
        const next = await readState(options.animus);
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
  await listener.listen(STATE_CHANNEL, (payload: string) => routeNotifyPayload(payload, { ...options, check }), check);
  await check();

  return {
    current: () => last!,
    close: () => listener.end(),
  };
}
