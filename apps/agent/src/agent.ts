import { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { createBrain, type Brain } from "@animus/brain";
import { EMOTION_TOPIC, type EmotionMessage } from "@animus/brain/emotion";
import { EMBEDDING_MODEL, loadType2Config, TYPE1_MODEL } from "@animus/brain/config";
import { createDb, migrate } from "@animus/db";
import {
  cli,
  defineAgent,
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
import { textStream } from "./text-stream.js";

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

class AnimusAgent extends voice.Agent {
  readonly #brain: Brain;
  readonly #room: JobContext["room"];

  constructor(brain: Brain, room: JobContext["room"]) {
    // instructions is verplicht op voice.Agent, maar onbenut: llmNode hieronder draait i.p.v. het
    // ingebouwde LLM-pad de brein-kern.
    super({ instructions: "Animus" });
    this.#brain = brain;
    this.#room = room;
  }

  override async llmNode(chatCtx: ChatContext, _toolCtx: ToolContext): Promise<ReadableStream<string> | null> {
    const isUserMessage = (item: ChatContext["items"][number]): item is ChatMessage =>
      item.type === "message" && item.role === "user";
    const text = chatCtx.items.filter(isUserMessage).at(-1)?.textContent;
    if (!text) return null;
    // tool-*-events uit brain.hear() worden hier genegeerd (ticket #7).
    return textStream(this.#brain.hear(text), {
      onEmotion: (emotion, intensity) => {
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
    const identity = await brain.boot();
    console.log(`Animus-agent: brein gebooted, wezen "${identity.name}"`);

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

    await session.start({ agent: new AnimusAgent(brain, ctx.room), room: ctx.room });
  },
});

// Zonder agentName wordt deze agent automatisch aan elke nieuwe room gedispatcht.
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
