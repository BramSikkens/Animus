import { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { createBrain, type Brain } from "@animus/brain";
import { DISPLAY_TOPIC, type DisplayMessage, type DisplayState } from "@animus/brain/display";
import { EMOTION_TOPIC, type EmotionMessage } from "@animus/brain/emotion";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL } from "@animus/brain/config";
import { createDb, migrate } from "@animus/db";
import {
  cli,
  defineAgent,
  llm,
  ServerOptions,
  voice,
  type ChatContext,
  type ChatMessage,
  type JobContext,
  type JobProcess,
  type ToolContext,
  type VAD,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent } from "@livekit/rtc-node";
import { readState, watchDynimos } from "./dynimo-watch.js";
import { createReflectionDisplay } from "./reflection-display.js";
import { createSilenceTimer, parseSilenceMinutes } from "./silence-timer.js";
import { textStream } from "./text-stream.js";
import { resolveDisplay, voiceDisplay } from "./voice-display.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}
process.env.LIVEKIT_URL ??= "ws://localhost:7880";
process.env.LIVEKIT_API_KEY ??= "devkey";
process.env.LIVEKIT_API_SECRET ??= "secret";

type AgentUserData = { vad: VAD };

// Zonder DEEPGRAM_API_KEY valt dit terug op OpenAI, spec-conform is Deepgram.
function speechProviders(): { stt: deepgram.STT | openai.STT; tts: deepgram.TTS | openai.TTS } {
  if (process.env.DEEPGRAM_API_KEY) {
    console.log("Spraakproviders: Deepgram (STT nova-3 nl, TTS aura-2-beatrix-nl)");
    return {
      stt: new deepgram.STT({ model: "nova-3", language: "nl" }),
      tts: new deepgram.TTS({ model: "aura-2-beatrix-nl" }),
    };
  }
  console.log("Spraakproviders: OpenAI (terugval, geen DEEPGRAM_API_KEY gezet)");
  // ponytail: OpenAI-TTS heeft geen streaming-API; LiveKit synthetiseert dan per zin (TTSStreamAdapter),
  // dus de eerste klank komt pas na een volledige zin. Zet DEEPGRAM_API_KEY voor de spec-conforme route.
  return {
    stt: new openai.STT({ model: "gpt-4o-transcribe", useRealtime: false, language: "nl" }),
    tts: new openai.TTS({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      instructions: "Spreek Nederlands, warm en natuurlijk.",
    }),
  };
}

// LiveKit genereert enkel een antwoord als er een LLM gezet is (agent_activity.userTurnCompleted:
// `if (this.llm === undefined) return`), ook al vervangt llmNode het LLM-pad volledig. Zonder
// deze placeholder blijft de agent stil na elke beurt. chat() wordt nooit aangeroepen.
class BrainPlaceholderLLM extends llm.LLM {
  label(): string {
    return "animus-brain";
  }

  chat(): never {
    throw new Error("BrainPlaceholderLLM.chat() mag niet aangeroepen worden: llmNode draait het brein.");
  }
}

class AnimusAgent extends voice.Agent {
  readonly #brain: Brain;
  readonly #room: JobContext["room"];
  readonly #onUtterance: () => void;

  constructor(brain: Brain, room: JobContext["room"], onUtterance: () => void) {
    // instructions is verplicht op voice.Agent, maar onbenut: llmNode hieronder draait i.p.v. het
    // ingebouwde LLM-pad de brein-kern.
    super({ instructions: "Animus", llm: new BrainPlaceholderLLM() });
    this.#brain = brain;
    this.#room = room;
    this.#onUtterance = onUtterance;
  }

  override async llmNode(chatCtx: ChatContext, _toolCtx: ToolContext): Promise<ReadableStream<string> | null> {
    const isUserMessage = (item: ChatContext["items"][number]): item is ChatMessage =>
      item.type === "message" && item.role === "user";
    const text = chatCtx.items.filter(isUserMessage).at(-1)?.textContent;
    if (!text) return null;
    this.#onUtterance();
    // tool-*-events uit brain.hear() worden hier genegeerd (ticket #7).
    return textStream(this.#brain.hear(text), {
      onMood: (emotion, intensity) => {
        const participant = this.#room.localParticipant;
        if (!participant) {
          console.error("Emotie niet gepubliceerd: agent is (nog) niet verbonden met de room.");
          return;
        }
        const message: EmotionMessage = { emotion, intensity };
        // Fire-and-forget: een mislukte publicatie mag de beurt niet breken.
        participant
          .publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: EMOTION_TOPIC })
          .catch((error: unknown) => {
            console.error("Emotie publiceren faalde:", error instanceof Error ? error.message : error);
          });
      },
    });
  }
}

export default defineAgent<AgentUserData>({
  async prewarm(proc: JobProcess<AgentUserData>) {
    proc.userData.vad = await silero.VAD.load();
  },

  async entry(ctx: JobContext<AgentUserData>) {
    const databaseUrl = process.env.DATABASE_URL ?? "postgres://animus:animus@localhost:5433/animus";
    const db = createDb(databaseUrl);
    await migrate(db);

    // In-process (spec: geen aparte brein-API); elke job krijgt zijn eigen brein-instantie.
    const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), embedder: EMBEDDING_MODEL });

    ctx.addShutdownCallback(async () => {
      await db.$client.end();
    });

    await ctx.connect();

    const { stt, tts } = speechProviders();
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt,
      tts,
      turnHandling: {
        // Het top-level `turnDetection` is deprecated; koppelen via turnHandling.
        turnDetection: new livekit.turnDetector.MultilingualModel(),
        // preemptiveGeneration draait llmNode (dus brain.hear()) speculatief vóórdat de beurt
        // bevestigd is; brain.hear() heeft side effects (Type1-call, DB-schrijven, geheugen
        // opslaan) die niet ongedaan te maken zijn als LiveKit de speculatieve beurt weggooit.
        // Niet in het ticket beschreven — hier bewust uitgezet i.p.v. de default (true).
        preemptiveGeneration: { enabled: false },
      },
    });

    const publish = (topic: string, message: DisplayMessage | EmotionMessage): void => {
      const participant = ctx.room.localParticipant;
      if (!participant) return;
      participant
        .publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic })
        .catch((error: unknown) => {
          console.error(`Publiceren op "${topic}" faalde:`, error instanceof Error ? error.message : error);
        });
    };
    // `watcher` en `publishState` bestaan pas verderop en worden hier enkel lui gebruikt (nooit tijdens de opbouw).
    let watcher!: Awaited<ReturnType<typeof watchDynimos>>;
    const reflectionDisplay = createReflectionDisplay({
      getCurrentKey: () => watcher.current().key,
      publishDisplay: (display) => publish(DISPLAY_TOPIC, { state: display }),
      publishState: () => void publishState(),
    });
    // luisterend/spreekt volgen LiveKit's AgentState/UserState (ADR-0011); reflecterend/slapend winnen daarvan.
    let agentState: voice.AgentState = "initializing";
    let userState: voice.UserState = "listening";
    const effectiveDisplay = (state: { key: string; display: DisplayState }): DisplayState =>
      resolveDisplay(reflectionDisplay.displayFor(state.key, state.display), voiceDisplay(agentState, userState));
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      agentState = event.newState;
      // `watcher` bestaat pas na session.start; eerdere events worden door de eerste publishState opgepikt.
      if (watcher) publish(DISPLAY_TOPIC, { state: effectiveDisplay(watcher.current()) });
    });
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (event) => {
      userState = event.newState;
      if (watcher) publish(DISPLAY_TOPIC, { state: effectiveDisplay(watcher.current()) });
    });
    // Weergavetoestand plus, bij wakker, de HUIDIGE Stemming (vers gelezen), zodat het gezichtje na wekken direct klopt.
    const publishState = async (): Promise<void> => {
      try {
        const state = await readState(brain);
        publish(DISPLAY_TOPIC, { state: effectiveDisplay(state) });
        if (state.mood) publish(EMOTION_TOPIC, state.mood);
      } catch (error) {
        console.error("Toestand publiceren faalde:", error instanceof Error ? error.message : error);
      }
    };

    // Reflectie bij stilte: na REFLECT_SILENCE_MINUTES zonder uiting reflecteert de wakkere Dynimo (hij blijft
    // wakker). Het gezichtje toont dan "reflecterend"; een uiting zet het meteen terug en de Reflectie loopt door.
    const silenceConfig = parseSilenceMinutes(process.env.REFLECT_SILENCE_MINUTES);
    if (silenceConfig.warning) console.warn(silenceConfig.warning);
    const silence = createSilenceTimer({
      thresholdMs: silenceConfig.ms,
      onSilence: () => {
        const key = watcher.current().key;
        void brain
          .reflect({ onStart: () => reflectionDisplay.onStart(key) })
          .then(() => reflectionDisplay.onFinish(key));
      },
    });
    ctx.addShutdownCallback(async () => silence.dispose());

    await session.start({
      agent: new AnimusAgent(brain, ctx.room, () => {
        silence.reset();
        reflectionDisplay.onUtterance();
      }),
      room: ctx.room,
    });

    // Volgt de wakkere Dynimo (dashboard-acties komen binnen via Postgres NOTIFY): een wissel breekt het
    // lopende antwoord af (zoals barge-in; de brain-stream sluit via textStream) en zet het gezichtje om.
    watcher = await watchDynimos({
      databaseUrl,
      brain,
      onChange: () => {
        // Een wissel beëindigt het reflecterende gezicht; een lopende Reflectie mag doorlopen maar publiceert
        // dan niets meer (sleutel-guard in reflectionDisplay).
        reflectionDisplay.onSwitch();
        silence.reset();
        // interrupt gooit/weigert als er niets te onderbreken valt; dat is geen fout.
        try {
          session.interrupt({ force: true }).await.catch(() => {});
        } catch {
          // niets lopend
        }
        void publishState();
      },
    });
    ctx.addShutdownCallback(() => watcher.close());
    void publishState();
    silence.arm();
    // Een later ladend gezichtje kent de toestand nog niet. ParticipantConnected vuurt vóórdat het gezichtje
    // zijn data-channel-subscriber gemount heeft, dus nog eens na een korte vertraging.
    // ponytail: een echte oplossing (state-sync via participant attributes of een request-bericht) pas nodig
    // als dit in de praktijk misgaat.
    const retryTimers = new Set<NodeJS.Timeout>();
    ctx.room.on(RoomEvent.ParticipantConnected, () => {
      void publishState();
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        void publishState();
      }, 2000);
      retryTimers.add(timer);
    });
    ctx.addShutdownCallback(async () => {
      for (const timer of retryTimers) clearTimeout(timer);
    });
  },
});

// Zonder agentName wordt deze agent automatisch aan elke nieuwe room gedispatcht.
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
