import { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { createBrain, defaultVoiceDeps, type Brain } from "@animus/brain";
import { DISPLAY_TOPIC, type DisplayMessage, type DisplayState } from "@animus/brain/display";
import { COMMAND_TOPIC, GALLERY_TOPIC, type GalleryMessage } from "@animus/brain/gallery";
import { isWaarneming, PERCEPTION_TOPIC, type Aanleiding } from "@animus/brain/perception";
import { SOUND_TOPIC, type SoundMessage } from "@animus/brain/sound";
import { EMOTION_TOPIC, type EmotionMessage } from "@animus/brain/emotion";
import { initiativeFactor } from "@animus/brain/behavior";
import { moodOfRow } from "@animus/brain/mood";
import { rowAxes } from "@animus/brain/personality";
import { resolveVoice, speechProvider } from "@animus/brain/voice";
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
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent, TrackSource, type RemoteParticipant } from "@livekit/rtc-node";
import { readState, watchDynimos } from "./dynimo-watch.js";
import { createStateRepublisher, emotionMessageFor, withFaceExpressiveness } from "./state-republish.js";
import { createCommandHandler, galleryMessageFor, MAX_GRAVES } from "./gallery-commands.js";
import { createFrameSource } from "./frame-source.js";
import { createInitiativeTimer, initiativeIntervalMs, parseInitiativeMinutes } from "./initiative-timer.js";
import { createPerception, parseReturnAfterMinutes } from "./perception.js";
import { createReflectionDisplay } from "./reflection-display.js";
import { createSilenceTimer, parseSilenceMinutes } from "./silence-timer.js";
import { voiceSettingsFor } from "@animus/brain/voice-emotion";
import { pacingFor, withPacingSpeed } from "@animus/brain/speech-pacing";
import { applyTtsEmotion, applyTtsVoice } from "./tts-voice.js";
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
function speechProviders(): { stt: deepgram.STT | openai.STT; tts: elevenlabs.TTS | deepgram.TTS | openai.TTS } {
  const provider = speechProvider(process.env);
  if (provider === "elevenlabs") {
    console.log("Spraakproviders: ElevenLabs TTS (Flash v2.5, nl), Deepgram/OpenAI STT");
    // Plugin leest zelf ELEVEN_API_KEY; onze env heet ELEVENLABS_API_KEY, dus expliciet meegeven.
    const tts = new elevenlabs.TTS({ apiKey: process.env.ELEVENLABS_API_KEY, model: "eleven_flash_v2_5", language: "nl" });
    return {
      stt: process.env.DEEPGRAM_API_KEY
        ? new deepgram.STT({ model: "nova-3", language: "nl" })
        : new openai.STT({ model: "gpt-4o-transcribe", useRealtime: false, language: "nl" }),
      tts,
    };
  }
  if (provider === "deepgram") {
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
  readonly #onMoodValues: (values: EmotionMessage["values"]) => void;
  readonly #getExpressiveness: () => number;
  #pendingInitiative: string | undefined;

  constructor(brain: Brain, room: JobContext["room"], onUtterance: () => void, onMoodValues: (values: EmotionMessage["values"]) => void, getExpressiveness: () => number = () => 0.5) {
    // instructions is verplicht op voice.Agent, maar onbenut: llmNode hieronder draait i.p.v. het
    // ingebouwde LLM-pad de brein-kern.
    super({ instructions: "Animus", llm: new BrainPlaceholderLLM() });
    this.#brain = brain;
    this.#room = room;
    this.#onUtterance = onUtterance;
    this.#onMoodValues = onMoodValues;
    this.#getExpressiveness = getExpressiveness;
  }

  /** Zet een spontane uiting klaar; de eerstvolgende llmNode (via session.generateReply) draait die i.p.v. een user-turn. */
  queueInitiative(instruction: string): void {
    this.#pendingInitiative = instruction;
  }

  override async llmNode(chatCtx: ChatContext, _toolCtx: ToolContext): Promise<ReadableStream<string> | null> {
    const isUserMessage = (item: ChatContext["items"][number]): item is ChatMessage =>
      item.type === "message" && item.role === "user";
    const initiative = this.#pendingInitiative;
    this.#pendingInitiative = undefined;
    const text = initiative ?? chatCtx.items.filter(isUserMessage).at(-1)?.textContent;
    if (!text) return null;
    this.#onUtterance();
    // tool-*-events uit brain.hear() worden hier genegeerd (ticket #7).
    return textStream(this.#brain.hear(text, { initiatief: initiative !== undefined }), {
      onMood: (message) => {
        // Vóór de eerste tekst (dus vóór de TTS-context van deze beurt opent): emotie in de stem.
        this.#onMoodValues(message.values);
        const participant = this.#room.localParticipant;
        if (!participant) {
          console.error("Emotie niet gepubliceerd: agent is (nog) niet verbonden met de room.");
          return;
        }
        // Fire-and-forget: een mislukte publicatie mag de beurt niet breken.
        participant
          .publishData(new TextEncoder().encode(JSON.stringify(withFaceExpressiveness(message, this.#getExpressiveness()))), { reliable: true, topic: EMOTION_TOPIC })
          .catch((error: unknown) => {
            console.error("Emotie publiceren faalde:", error instanceof Error ? error.message : error);
          });
      },
      onSound: (kind) => {
        const participant = this.#room.localParticipant;
        if (!participant) return;
        const message: SoundMessage = { kind };
        participant
          .publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: SOUND_TOPIC })
          .catch((error: unknown) => {
            console.error("Geluid publiceren faalde:", error instanceof Error ? error.message : error);
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

    // Kijken (ADR-0018/0019): het laatste camerabeeld van de room, vóór createBrain zodat lookFrame meteen mee kan.
    const frames = createFrameSource(ctx.room);
    // In-process (spec: geen aparte brein-API); elke job krijgt zijn eigen brein-instantie.
    // voices: een geboorte vanuit de Galerij kiest net als in het dashboard een stem.
    const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), embedder: EMBEDDING_MODEL, voices: defaultVoiceDeps(process.env), lookFrame: () => frames.latest() });

    ctx.addShutdownCallback(async () => frames.dispose());
    ctx.addShutdownCallback(async () => {
      await db.$client.end();
    });

    await ctx.connect();

    const { stt, tts } = speechProviders();
    // De stem van de wakkere Dynimo (fallback: de default van de provider) op de gedeelde TTS zetten.
    const applyVoice = (stored: string | null): void => {
      const provider = speechProvider(process.env);
      applyTtsVoice(provider, tts, resolveVoice(provider, stored, process.env.ELEVENLABS_DEFAULT_VOICE_ID));
    };
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

    const publish = (topic: string, message: DisplayMessage | GalleryMessage | ReturnType<typeof emotionMessageFor>): void => {
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
        publish(DISPLAY_TOPIC, { state: effectiveDisplay(state), name: state.name });
        publish(EMOTION_TOPIC, withFaceExpressiveness(emotionMessageFor(state.mood), state.expressiveness));
      } catch (error) {
        console.error("Toestand publiceren faalde:", error instanceof Error ? error.message : error);
      }
    };

    // Galerij: alle levende Dynimo's (naam, wakker) voor het startscherm van het gezichtje.
    const publishGallery = async (): Promise<void> => {
      try {
        // Grafschriften lees ik hier rechtstreeks (ADR-0003: het brein leest die tabel nooit).
        const graves = await db.query.epitaphs.findMany({ orderBy: (e, { desc }) => desc(e.deletedAt), limit: MAX_GRAVES });
        publish(GALLERY_TOPIC, galleryMessageFor(await brain.list(), graves));
      } catch (error) {
        console.error("Galerij publiceren faalde:", error instanceof Error ? error.message : error);
      }
    };
    // Commando's van het gezichtje (dev-only, geen auth): birth/wake/sleep/kill; handler valideert zelf.
    const handleCommand = createCommandHandler({
      brain,
      publishGallery: () => void publishGallery(),
      onError: (error) => console.error("Commando uitvoeren faalde:", error instanceof Error ? error.message : error),
    });
    ctx.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== COMMAND_TOPIC) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      void handleCommand(parsed);
    });

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

    // Initiatief: periodiek vraagt de brain (Type1) of de wakkere Dynimo iets wil zeggen; zo ja, dan spreekt hij
    // uit zichzelf. Enkel bij stilte (agent niet speaking/thinking, gebruiker niet aan het praten); de frequentie
    // volgt de N/P-kant van de Persoonlijkheid.
    const initiativeBaseMs = parseInitiativeMinutes(process.env.INITIATIVE_CHECK_MINUTES);
    if (initiativeBaseMs.warning) console.warn(initiativeBaseMs.warning);
    // Aanwezigheid (ADR-0018): zonder iemand in beeld slaat de periodieke check over; een terugkomst na een lange
    // afwezigheid lokt de check meteen uit met de aanleiding "terug".
    const returnAfterConfig = parseReturnAfterMinutes(process.env.RETURN_AFTER_MINUTES);
    if (returnAfterConfig.warning) console.warn(returnAfterConfig.warning);
    const perception = createPerception({ now: Date.now, returnAfterMs: returnAfterConfig.ms });
    let initiativeAxes: ReturnType<typeof rowAxes> = null;
    let initiativeMoodFactor = 1;
    const refreshInitiativeAxes = async (): Promise<void> => {
      const awake = (await brain.list()).find((dynimo) => dynimo.awakeSince);
      initiativeAxes = rowAxes(awake ?? { axisIe: null, axisSn: null, axisTf: null, axisJp: null, axisReactivity: 0.5, axisExpressiveness: 0.5 });
      // Zeer blij: vaker eigen initiatief (behavior.ts).
      initiativeMoodFactor = awake && initiativeAxes ? initiativeFactor(moodOfRow(awake, new Date()).values, initiativeAxes) : 1;
    };
    const animusAgent = new AnimusAgent(brain, ctx.room, () => {
      silence.reset();
      initiative.reset();
      reflectionDisplay.onUtterance();
    }, (values) => {
      // Expressiviteit uit de gecachete assen (refresh bij start, wissel en initiatief-check).
      const expressiveness = initiativeAxes?.expressiveness ?? 0.5;
      // Tempo per Emotie (#70) via speed; de afronding in applyTtsEmotion voorkomt extra websocket-herstarts.
      applyTtsEmotion(speechProvider(process.env), tts, withPacingSpeed(voiceSettingsFor({ values, expressiveness }), pacingFor({ values, expressiveness }).speedFactor));
    }, () => initiativeAxes?.expressiveness ?? 0.5);
    const isQuiet = (): boolean =>
      (session.agentState === "idle" || session.agentState === "listening") && session.userState !== "speaking" && perception.isPresent();
    // Gedeeld door de timer-tick en een Waarneming (aanleiding "terug"): een in-flight-guard voorkomt dat ze
    // tegelijk een initiatief klaarzetten.
    // ponytail: een aanleiding die binnenkomt terwijl het niet stil is (of er al een check loopt) vervalt; een wachtrij
    // pas als terugkomsten in de praktijk gemist worden.
    let initiativeInFlight = false;
    const runInitiative = async (aanleiding?: Aanleiding): Promise<void> => {
      if (initiativeInFlight || !isQuiet()) return;
      initiativeInFlight = true;
      try {
        await refreshInitiativeAxes();
        const instruction = await brain.considerInitiative(aanleiding);
        // Opnieuw controleren: de check duurde even, misschien is er intussen iemand gaan praten.
        if (!instruction || !isQuiet()) return;
        animusAgent.queueInitiative(instruction);
        session.generateReply();
      } finally {
        initiativeInFlight = false;
      }
    };
    const initiative = createInitiativeTimer({
      intervalMs: () => initiativeIntervalMs(initiativeAxes, initiativeBaseMs.ms, initiativeMoodFactor),
      random: Math.random,
      isQuiet,
      onCheck: () => runInitiative(),
    });
    ctx.addShutdownCallback(async () => initiative.dispose());

    // Waarnemingen van de face-app (ADR-0018): aanwezig/afwezig over PERCEPTION_TOPIC; enkel van een remote
    // participant (niet van de agent zelf).
    // ponytail: elke remote deelnemer mag Waarnemingen sturen (dev-only, zoals COMMAND_TOPIC); twee face-tabs kunnen
    // elkaar dan overschrijven.
    ctx.room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== PERCEPTION_TOPIC || !participant) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      if (!isWaarneming(parsed)) return;
      const aanleiding = perception.onWaarneming(parsed);
      if (aanleiding) runInitiative(aanleiding).catch((error: unknown) => console.warn("Initiatief-check faalde:", error instanceof Error ? error.message : error));
    });
    // Vertrekt de face-app terwijl niemand in beeld was, dan mag "afwezig" het initiatief niet voorgoed stilleggen.
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => perception.reset());

    // closeOnDisconnect uit: anders sluit de sessie (en stopt de job) zodra de eerste face disconnect, terwijl de room
    // voor een andere tab blijft bestaan; LiveKit dispatcht enkel bij room-creatie, dus die tab zag dan geen agent.
    // De job eindigt nu pas met de room; alle timers/watchers ruimen op via de shutdown-callbacks.
    await session.start({ agent: animusAgent, room: ctx.room, inputOptions: { closeOnDisconnect: false } });

    // De sessie luistert naar één deelnemer (de eerste face) en blijft die trouw, ook als die tab al weg is; elke
    // reload is een nieuwe identiteit. Wij luisteren naar wie zijn microfoon aanzet: de face met een gekozen Dynimo.
    // ponytail: `_roomIO` is private API van @livekit/agents 1.9; bij een upgrade nakijken (RoomIO.setParticipant).
    const listenTo = (participant: RemoteParticipant): void => session._roomIO?.setParticipant(participant.identity);
    const hasMic = (participant: RemoteParticipant): boolean =>
      [...participant.trackPublications.values()].some((t) => t.source === TrackSource.SOURCE_MICROPHONE && !t.muted);
    const speaker = [...ctx.room.remoteParticipants.values()].find(hasMic);
    if (speaker) listenTo(speaker);
    ctx.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (publication.source === TrackSource.SOURCE_MICROPHONE) listenTo(participant);
    });
    // Uitzetten muted enkel; weer aanzetten is dan een unmute, geen nieuwe publicatie.
    ctx.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (participant !== ctx.room.localParticipant && publication.source === TrackSource.SOURCE_MICROPHONE) listenTo(participant as RemoteParticipant);
    });

    // Volgt de wakkere Dynimo (dashboard-acties komen binnen via Postgres NOTIFY): een wissel breekt het
    // lopende antwoord af (zoals barge-in; de brain-stream sluit via textStream) en zet het gezichtje om.
    watcher = await watchDynimos({
      databaseUrl,
      brain,
      onMood: () => void publishState(),
      onNotify: () => void publishGallery(),
      onVoice: () => void readState(brain).then((state) => applyVoice(state.voice)).catch(() => {}),
      onChange: (state) => {
        applyVoice(state.voice);
        // Een wissel beëindigt het reflecterende gezicht; een lopende Reflectie mag doorlopen maar publiceert
        // dan niets meer (sleutel-guard in reflectionDisplay).
        reflectionDisplay.onSwitch();
        silence.reset();
        initiative.reset();
        perception.reset();
        void refreshInitiativeAxes().catch(() => {});
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
    applyVoice(watcher.current().voice);
    void publishState();
    void publishGallery();
    // De Stemming dooft uit met de tijd: periodiek opnieuw publiceren laat de balken meelopen (enkel bij wakker + face).
    const republisher = createStateRepublisher({
      intervalMs: 5000,
      isActive: () => watcher.current().key !== "none" && ctx.room.remoteParticipants.size > 0,
      publish: () => void publishState(),
    });
    republisher.start();
    const galleryRepublisher = createStateRepublisher({
      intervalMs: 5000,
      isActive: () => ctx.room.remoteParticipants.size > 0,
      publish: () => void publishGallery(),
    });
    galleryRepublisher.start();
    ctx.addShutdownCallback(async () => galleryRepublisher.dispose());
    ctx.addShutdownCallback(async () => republisher.dispose());
    silence.arm();
    void refreshInitiativeAxes().catch(() => {});
    initiative.start();
    // Een later ladend gezichtje kent de toestand nog niet. ParticipantConnected vuurt vóórdat het gezichtje
    // zijn data-channel-subscriber gemount heeft, dus nog eens na een korte vertraging.
    // ponytail: een echte oplossing (state-sync via participant attributes of een request-bericht) pas nodig
    // als dit in de praktijk misgaat.
    const retryTimers = new Set<NodeJS.Timeout>();
    ctx.room.on(RoomEvent.ParticipantConnected, () => {
      void publishState();
      void publishGallery();
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        void publishState();
        void publishGallery();
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
