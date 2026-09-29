import { fileURLToPath } from "node:url";
import { createBrain, defaultVoiceDeps } from "@animus/brain";
import type { DisplayState } from "@animus/brain/display";
import { DISPLAY_TOPIC, type DisplayMessage } from "@animus/protocol/display";
import { COMMAND_TOPIC, GALLERY_TOPIC, type GalleryMessage } from "@animus/protocol/gallery";
import type { Aanleiding, Gesprekspartner } from "@animus/brain/perception";
import { decodeEmbedding, isWaarneming, PERCEPTION_TOPIC } from "@animus/protocol/perception";
import { EMOTION_TOPIC } from "@animus/brain/emotion";
import { KENMERKEN_TOPIC, type KenmerkenMessage } from "@animus/protocol/kenmerken";
import { initiativeFactor } from "@animus/brain/behavior";
import { isEigenaar, livekitEnv } from "@animus/protocol/security";
import { moodOfRow } from "@animus/brain/mood";
import { rowAxes } from "@animus/brain/personality";
import { resolveVoice, speechProvider } from "@animus/brain/voice";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL, type2Catalog } from "@animus/brain/config";
import { createJobQueue } from "@animus/brain/jobs";
import { createDb, migrate } from "@animus/db";
import { cli, defineAgent, ServerOptions, voice, type JobContext, type JobProcess, type VAD } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent, TrackSource, type RemoteParticipant } from "@livekit/rtc-node";
import { readState, watchDynimos } from "./dynimo-watch.js";
import { createStateRepublisher, emotionMessageFor, kenmerkenMessageFor, withFaceExpressiveness } from "./state-republish.js";
import { vertrouwdheidFor } from "./vertrouwdheid.js";
import { createCommandHandler, galleryMessageFor, MAX_GRAVES } from "./gallery-commands.js";
import { createFrameSource } from "./frame-source.js";
import { createInitiativeTimer, initiativeIntervalMs, parseInitiativeMinutes } from "./initiative-timer.js";
import { createPerception, parseLookCooldownMinutes, parseReturnAfterMinutes } from "./perception.js";
import { createReflectionDisplay } from "./reflection-display.js";
import { createSilenceTimer, parseSilenceMinutes } from "./silence-timer.js";
import { createEagleSpeakerId } from "./eagle-speaker-id.js";
import { createFaces, parseFaceMatchDistance } from "./faces.js";
import { parseSpeakerMatchThreshold, type SpeakerId } from "./speaker-id.js";
import { createSpeakerAudio } from "./speaker-audio.js";
import { voiceSettingsFor } from "./voice-emotion.js";
import { pacingFor, withPacingSpeed } from "@animus/brain/speech-pacing";
import { applyTtsEmotion, applyTtsVoice } from "./tts-voice.js";
import { resolveDisplay, voiceDisplay } from "./voice-display.js";
import { AnimusAgent } from "./animus-agent.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env is optioneel: de omgevingsvariabelen kunnen ook al gezet zijn (bv. via shell/CI).
}
const livekitConfig = livekitEnv(process.env);
process.env.LIVEKIT_URL = livekitConfig.url;
process.env.LIVEKIT_API_KEY = livekitConfig.apiKey;
process.env.LIVEKIT_API_SECRET = livekitConfig.apiSecret;

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
    // Gezichtsherkenning (#93, ADR-0020): drempel via env, afgeleid van Human's similarity-vuistregel.
    const faceMatchDistanceConfig = parseFaceMatchDistance(process.env.FACE_MATCH_DISTANCE);
    if (faceMatchDistanceConfig.warning) console.warn(faceMatchDistanceConfig.warning);

    // Reflectie via de wachtrij (#125, ADR-0022): de agent plant enkel in, de worker voert uit.
    const jobs = createJobQueue({ connection: process.env.REDIS_URL ?? "redis://localhost:6379" });

    // In-process (spec: geen aparte brein-API); elke job krijgt zijn eigen brein-instantie.
    // voices: een geboorte vanuit de Galerij kiest net als in het dashboard een stem.
    const brain = createBrain({ db, type1: TYPE1_MODEL, type2: loadType2Config(), type2Catalog: type2Catalog(), embedder: EMBEDDING_MODEL, voices: defaultVoiceDeps(process.env), lookFrame: () => frames.latest(), faceMatchDistance: faceMatchDistanceConfig.distance, jobs });

    ctx.addShutdownCallback(async () => frames.dispose());
    ctx.addShutdownCallback(async () => {
      // Shutdown-callbacks draaien parallel (Promise.allSettled): settled() moet hier, vóór db.$client.end(),
      // wachten in dezelfde callback — anders gaan Herinneringen die nog op de achtergrond opslaan (#109) verloren.
      // Idem de wachtrij (#126): settled() wacht op job-resultaten, dus pas daarna de Redis-verbindingen sluiten.
      await brain.settled();
      await jobs.close();
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

    // Stemherkenning (#92, ADR-0020): enkel aan als de sleutel gezet is én Eagle initialiseert; anders precies het
    // huidige gedrag (geen gesprekspartner-optie, hear() valt terug op de eigenaar).
    const speakerThreshold = parseSpeakerMatchThreshold(process.env.SPEAKER_MATCH_THRESHOLD);
    if (speakerThreshold.warning) console.warn(speakerThreshold.warning);
    let speakerRecognition: { speakerId: SpeakerId; audio: ReturnType<typeof createSpeakerAudio> } | undefined;
    if (process.env.PICOVOICE_ACCESS_KEY) {
      let speakerId: SpeakerId | undefined;
      try {
        speakerId = createEagleSpeakerId({
          accessKey: process.env.PICOVOICE_ACCESS_KEY,
          threshold: speakerThreshold.threshold,
          loadProfiles: () => brain.voiceProfiles(),
          saveProfile: (personId, profile) => brain.addVoiceProfile(personId, profile),
        });
        await speakerId.reload();
        const audio = createSpeakerAudio(ctx.room, () => session.userState === "speaking");
        speakerRecognition = { speakerId, audio };
      } catch (error) {
        // reload() kan falen ná een geslaagde new Eagle(...): dan wél de native resources weer vrijgeven.
        speakerId?.dispose();
        console.warn("Stemherkenning (Eagle) kon niet starten, blijft uit:", error instanceof Error ? error.message : error);
      }
    }
    ctx.addShutdownCallback(async () => {
      speakerRecognition?.speakerId.dispose();
      speakerRecognition?.audio.dispose();
    });

    const publish = (topic: string, message: DisplayMessage | GalleryMessage | ReturnType<typeof emotionMessageFor> | KenmerkenMessage | null): void => {
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
    // Gesprekspartner van de laatst afgelopen beurt (#105/#115): geen-signaal tot de eerste beurt (dan geldt de
    // eigenaar, net als hear()); gebruikt door publishState() om de Vertrouwdheid te tonen zonder een verse beurt.
    let lastGesprekspartner: Gesprekspartner = { soort: "geen-signaal" };
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
    // Enkel wat vervaagt (#111): de 5s-ronde gebruikt alleen dit, niet de kenmerken (die vragen een aparte, tragere lezing).
    const publishMood = async (): Promise<void> => {
      try {
        const state = await readState(brain);
        publish(DISPLAY_TOPIC, { state: effectiveDisplay(state), name: state.name });
        publish(EMOTION_TOPIC, withFaceExpressiveness(emotionMessageFor(state.mood), state.expressiveness));
      } catch (error) {
        console.error("Toestand publiceren faalde:", error instanceof Error ? error.message : error);
      }
    };
    // Kenmerken (#105/#111): met de Gesprekspartner van de laatst afgelopen beurt (of de eigenaar zonder beurt).
    // Ververst bij NOTIFY ("kenmerken:"/"persons:"), na een beurt en via een trage verversing (~60s) — niet elke 5s.
    const publishKenmerken = async (): Promise<void> => {
      try {
        const state = await readState(brain);
        const vertrouwdheid = state.row
          ? await vertrouwdheidFor({ familiarityOf: brain.familiarityOf, personName: brain.personName }, state.row.id, lastGesprekspartner)
          : { onbekend: true as const };
        publish(KENMERKEN_TOPIC, kenmerkenMessageFor(state.row, vertrouwdheid));
      } catch (error) {
        console.error("Kenmerken publiceren faalde:", error instanceof Error ? error.message : error);
      }
    };
    // Alles (start/wissel/eerste publicatie na een nieuwe deelnemer): de face-app kent de toestand dan nog niet.
    const publishState = async (): Promise<void> => {
      await publishMood();
      await publishKenmerken();
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
    // Commando's van het gezichtje (enkel van een eigenaar-identity, #116): birth/wake/sleep/kill; handler valideert zelf.
    const handleCommand = createCommandHandler({
      brain,
      publishGallery: () => void publishGallery(),
      onError: (error) => console.error("Commando uitvoeren faalde:", error instanceof Error ? error.message : error),
    });
    ctx.room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== COMMAND_TOPIC || !participant || !isEigenaar(participant.identity)) return;
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
      // De worker voert de Reflectie uit en meldt start/einde zelf op het toestandskanaal (watchDynimos' onReflectie
      // hieronder); hier enkel nog inplannen.
      onSilence: () => void brain.reflect({ aanwezig: faces.seenAny() ? faces.present(Date.now()) : undefined }),
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
    // Spontaan Kijken (#87): een nieuw object lokt de initiatiefcheck uit, begrensd door deze cooldown.
    const lookCooldownConfig = parseLookCooldownMinutes(process.env.SPONTANEOUS_LOOK_COOLDOWN_MINUTES);
    if (lookCooldownConfig.warning) console.warn(lookCooldownConfig.warning);
    const perception = createPerception({ now: Date.now, returnAfterMs: returnAfterConfig.ms, lookCooldownMs: lookCooldownConfig.ms });
    // Gezichten (#93): aparte, klok-geïnjecteerde module (los van createPerception, dat gaat over aanwezig/afwezig/nieuw-object).
    const faces = createFaces();
    let initiativeAxes: ReturnType<typeof rowAxes> = null;
    let initiativeMoodFactor = 1;
    const refreshInitiativeAxes = async (): Promise<void> => {
      const awake = (await brain.list()).find((dynimo) => dynimo.awakeSince);
      initiativeAxes = rowAxes(awake ?? { axisIe: null, axisSn: null, axisTf: null, axisJp: null, axisReactivity: 0.5, axisExpressiveness: 0.5 });
      // Zeer blij: vaker eigen initiatief (behavior.ts).
      initiativeMoodFactor = awake && initiativeAxes ? initiativeFactor(moodOfRow(awake, new Date()).values, initiativeAxes) : 1;
    };
    const animusAgent = new AnimusAgent({
      brain,
      room: ctx.room,
      onUtterance: () => {
        silence.reset();
        initiative.reset();
        reflectionDisplay.onUtterance();
      },
      onMoodValues: (values) => {
        // Expressiviteit uit de gecachete assen (refresh bij start, wissel en initiatief-check).
        const expressiveness = initiativeAxes?.expressiveness ?? 0.5;
        // Tempo per Emotie (#70) via speed; de afronding in applyTtsEmotion voorkomt extra websocket-herstarts.
        applyTtsEmotion(speechProvider(process.env), tts, withPacingSpeed(voiceSettingsFor({ values, expressiveness }), pacingFor({ values, expressiveness }).speedFactor));
      },
      getExpressiveness: () => initiativeAxes?.expressiveness ?? 0.5,
      speaker: speakerRecognition,
      faces,
      cameraActive: () => frames.hasCamera(),
      onBeurtAfgelopen: (gesprekspartner) => {
        lastGesprekspartner = gesprekspartner;
        // Enkel kenmerken (Vertrouwdheid) en Galerij (#111): de Stemming zelf gaat al live via onMoodValues.
        void publishKenmerken();
        void publishGallery();
      },
    });
    const isQuiet = (): boolean =>
      (session.agentState === "idle" || session.agentState === "listening") && session.userState !== "speaking" && perception.isPresent();
    // Gedeeld door de timer-tick en een Waarneming (aanleiding "terug"): een in-flight-guard voorkomt dat ze
    // tegelijk een initiatief klaarzetten.
    // ponytail: een aanleiding die binnenkomt terwijl het niet stil is (of er al een check loopt) vervalt; een nieuw
    // object is dan ook als gezien gemarkeerd en de cooldown loopt. Een wachtrij pas als dat in de praktijk stoort.
    let initiativeInFlight = false;
    const runInitiative = async (aanleiding?: Aanleiding): Promise<void> => {
      if (initiativeInFlight || !isQuiet()) return;
      initiativeInFlight = true;
      try {
        await refreshInitiativeAxes();
        const instruction = await brain.considerInitiative(aanleiding, { aanwezig: faces.seenAny() ? faces.present(Date.now()) : undefined });
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
    // Enkel van een eigenaar-identity (#116); ponytail: twee face-tabs van de eigenaar kunnen elkaar nog overschrijven.
    ctx.room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== PERCEPTION_TOPIC || !participant || !isEigenaar(participant.identity)) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      if (!isWaarneming(parsed)) return;
      // Gezicht (#93): geen presence-Waarneming, apart afgehandeld (matchen + faces.ts bijwerken).
      if (parsed.soort === "gezicht") {
        const decoded = decodeEmbedding(parsed.embedding);
        if (!decoded) return; // al gevalideerd door isWaarneming; defensief
        const aantal = parsed.aantal;
        brain
          .recognizeFaces([decoded])
          .then(([personId]) => {
            faces.record(personId ?? null, Date.now(), aantal);
            if (faces.unknownStableSince(Date.now())) return runInitiative({ soort: "onbekend" });
          })
          .catch((error: unknown) => console.warn("Gezicht herkennen faalde:", error instanceof Error ? error.message : error));
        return;
      }
      const aanleiding = perception.onWaarneming(parsed);
      if (aanleiding) runInitiative(aanleiding).catch((error: unknown) => console.warn("Initiatief-check faalde:", error instanceof Error ? error.message : error));
    });
    // Vertrekt de face-app terwijl niemand in beeld was, dan mag "afwezig" het initiatief niet voorgoed stilleggen.
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
      perception.reset();
      faces.reset();
    });

    // closeOnDisconnect uit: anders sluit de sessie (en stopt de job) zodra de eerste face disconnect, terwijl de room
    // voor een andere tab blijft bestaan; LiveKit dispatcht enkel bij room-creatie, dus die tab zag dan geen agent.
    // De job eindigt nu pas met de room; alle timers/watchers ruimen op via de shutdown-callbacks.
    await session.start({ agent: animusAgent, room: ctx.room, inputOptions: { closeOnDisconnect: false } });

    // De sessie luistert naar één deelnemer (de eerste face) en blijft die trouw, ook als die tab al weg is; elke
    // reload is een nieuwe identiteit. Wij luisteren naar wie zijn microfoon aanzet: de face met een gekozen Dynimo.
    // ponytail: `_roomIO` is private API van @livekit/agents 1.9; bij een upgrade nakijken (RoomIO.setParticipant).
    const listenTo = (participant: RemoteParticipant): void => {
      if (!isEigenaar(participant.identity)) return;
      session._roomIO?.setParticipant(participant.identity);
      speakerRecognition?.audio.listenTo(participant.identity);
    };
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
      onMood: () => void publishMood(),
      // Assen/Verstand/Vertrouwdheid gewijzigd (ook "persons:", #111 criterium 3): kenmerken ververst, én de
      // gecachete assen (Expressiviteit voor gezicht én TTS), zodat die niet tussen oud en nieuw springen.
      onKenmerken: () => {
        void publishKenmerken();
        void refreshInitiativeAxes().catch(() => {});
      },
      onNotify: () => void publishGallery(),
      // Reflectie van de worker (#125): de initiatief-blokkade volgt altijd, het "reflecterend"-gezicht enkel als
      // het de huidige wakkere Dynimo is (een Reflectie bij slapen/wisselen hoort niet meer bij de huidige generatie).
      onReflectie: (phase, dynimoId) => {
        brain.noteReflection(dynimoId, phase === "start");
        const state = watcher.current();
        if (state.row?.id !== dynimoId) return;
        if (phase === "start") reflectionDisplay.onStart(state.key);
        else reflectionDisplay.onFinish(state.key);
      },
      onVoice: () =>
        void readState(brain)
          .then((state) => applyVoice(state.voice))
          .catch((error: unknown) => console.warn("Stem herladen faalde:", error instanceof Error ? error.message : error)),
      // Personen samengevoegd/verwijderd/opnieuw geleerd (#95): Stemprofielen, de gezien-bijhouding en een lopende
      // stem-inschrijving (#107: de Persoon kan weg zijn) zijn verouderd.
      onPersons: () => {
        animusAgent.cancelEnrollment();
        void speakerRecognition?.speakerId
          .reload()
          .catch((error: unknown) => console.warn("Stemprofielen herladen faalde:", error instanceof Error ? error.message : error));
        faces.reset();
      },
      onChange: (state) => {
        applyVoice(state.voice);
        // Wissel of slapen (#107): een lopende stem-inschrijving hoort bij het vorige gesprek.
        animusAgent.cancelEnrollment();
        // Een wissel beëindigt het reflecterende gezicht; een lopende Reflectie mag doorlopen maar publiceert
        // dan niets meer (sleutel-guard in reflectionDisplay).
        reflectionDisplay.onSwitch();
        silence.reset();
        initiative.reset();
        perception.reset();
        faces.reset();
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
    // Enkel wat vervaagt (#111): kenmerken/Galerij hebben hun eigen, tragere ronde hieronder.
    const republisher = createStateRepublisher({
      intervalMs: 5000,
      isActive: () => watcher.current().key !== "none" && ctx.room.remoteParticipants.size > 0,
      publish: () => void publishMood(),
    });
    republisher.start();
    // Trage verversing (~60s, #111) als vangnet: kenmerken/Galerij veranderen zelden buiten NOTIFY/een beurt om.
    const slowRepublisher = createStateRepublisher({
      intervalMs: 60_000,
      isActive: () => ctx.room.remoteParticipants.size > 0,
      publish: () => {
        void publishGallery();
        void publishKenmerken();
      },
    });
    slowRepublisher.start();
    ctx.addShutdownCallback(async () => slowRepublisher.dispose());
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
