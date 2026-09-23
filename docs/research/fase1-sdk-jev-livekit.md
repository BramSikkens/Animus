# Onderzoek fase 1: Jev, AI SDK v7, LiveKit Agents, Drizzle + pgvector

Stand 2026-09-23. Geverifieerd door de npm-tarballs te lezen (`.d.ts`/bron); webbronnen enkel waar vermeld.

## Jev (TypeSafe "System One Model") — Type1

**Gekozen route: Vercel AI Gateway via de AI SDK** (zie ADR-0005). Rechtstreekse TypeSafe-sleutel is niet beschikbaar.

- Model-id `typesafe-ai/jev` (hardcoded in `@ai-sdk/gateway@4.0.90`, `GatewayEvaluationModelId`); auth `AI_GATEWAY_API_KEY`. Bronnen: https://vercel.com/docs/ai-gateway/modalities/evaluation, https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- `experimental_evaluate({ model, state, questions })` uit `ai@7`; vraagtypen `choice` (criteria = map), `score` (criteria = array; score = geïnterpoleerde index, bij 2 criteria dus 0–1), `boolean` (→ `probability`).
- Mock: `Experimental_EvaluationMockModelV4` uit `ai/test`; interface `Experimental_EvaluationModelV4` (`doEvaluate`).
- **OpenRouter biedt Jev niet aan** — geverifieerd via `GET https://openrouter.ai/api/v1/models` (geen typesafe/jev) en 404 op `/api/v1/models/typesafe/jev-1.13`. Webpagina's die het tegendeel beweren zijn verzonnen (de OpenRouter-SPA geeft 200 op elke URL).
- Cloudflare Workers AI (`typesafe/jev`) staat in hun docs, niet live geverifieerd. Requesty/LiteLLM onbevestigd; AWS Bedrock niet.

### Rechtstreekse TypeSafe-API (niet gebruikt)

- npm: `@typesafe-ai/sdk@0.6.0` (pre-1.0, Node ≥20). Repo: https://github.com/typesafe-ai/typesafe-sdk-js
- Endpoint `POST https://api.typesafe.ai/v1/systemone`, auth `Authorization: Bearer <TYPESAFE_API_KEY>`.
- Env: `TYPESAFE_API_KEY` (verplicht), `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`), `TYPESAFE_LOG_LEVEL`.
- Primitives: `choice(instr, {label: desc|null})` (criteria = **map**), `score(instr, [..])` (criteria = **array**, ≥2), `noul(instr)` (ja/nee-kans).
- Responses: `choice → { choice, confidence, probabilities }`, `score → { score, confidence, legend, probabilities }` (score fractioneel, verwachtingswaarde), `noul → { noul }` (0–1).
- Geen apart 0–1-primitive voor intensiteit: `score(instr, ['laag','hoog'])` geeft een waarde tussen 0 en 1.

```ts
import { TypeSafeClient, choice, score } from '@typesafe-ai/sdk';
const { answers } = await new TypeSafeClient().systemOne({
  state: 'tekst',
  questions: {
    emotie: choice('Welke emotie overheerst?', { blij: null, boos: null, /* … */ neutraal: null }),
    intensiteit: score('Hoe intens is de emotie?', ['laag', 'hoog']),
    complexiteit: choice('Is dit bericht simpel of complex?', { simpel: null, complex: null }),
  },
});
```

Pas op: secundaire "docs"-sites (jevapi.org, community-repo's) bevatten verzonnen endpoints en foute voorbeelden (map bij `score`). Enkel de SDK-bron volgen. Latency volgens secundaire bronnen 70–500 ms end-to-end, niet strikt sub-100ms.

## Vercel AI SDK — `ai@7`

- `zod` peer: `^3.25.76 || ^4.1.8`.
- Mock: `MockLanguageModelV4` uit `ai/test`. Usage in `finish`-chunk is genest: `{ inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }`.
- Gestructureerde output: `generateText({ output: Output.object({ schema }) })`; `generateObject` is deprecated.
- `system` heet nu `instructions`; system-messages in `messages`/`prompt` worden standaard geweigerd. Caching: `instructions: { role: 'system', content, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }`.
- Tools: `tool({ description, inputSchema, execute })`; multi-step `stopWhen: isStepCount(n)` (`stepCountIs` = deprecated alias).
- Stream-toolcall-chunk: `{ type: 'tool-call', toolCallId, toolName, input: '<json-string>' }`.
- Registry: `createProviderRegistry({ anthropic, openai }).languageModel('anthropic:…')`.

## LiveKit Agents (Node) — `@livekit/agents@1.9.0`

- Plugins op 1.9.0: `-plugin-silero`, `-plugin-deepgram` (STT + TTS, default TTS `aura-2-andromeda-en`), `-plugin-livekit` (turn detector: `turnDetector.EnglishModel` / `MultilingualModel`, modellen eerst downloaden via `download-files`).
- Eigen brein i.p.v. LLM: `voice.Agent` subclass met `llmNode(chatCtx, toolCtx, modelSettings): Promise<ReadableStream<ChatChunk | string> | null>`; `llm` is optioneel op `AgentSession`.
- Worker: `cli.runApp(new ServerOptions({ agent: import.meta.filename }))` (`WorkerOptions` = alias). Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`.
- Data channel (agent-kant, `@livekit/rtc-node`): `room.localParticipant.publishData(bytes, { reliable: true, topic })`.
- Browser: `livekit-client@2.22`, `@livekit/components-react@2.9`; token via `livekit-server-sdk@2.19` `AccessToken` + `addGrant({ roomJoin: true, room })` (web-bron: https://docs.livekit.io/frontends/authentication/tokens/endpoint/).

## Drizzle + pgvector (webbron: https://orm.drizzle.team/docs/guides/vector-similarity-search)

- `vector('embedding', { dimensions: 1536 })`; HNSW: `index('…').using('hnsw', t.embedding.op('vector_cosine_ops'))`.
- `CREATE EXTENSION IF NOT EXISTS vector;` handmatig in een (custom) migratie, vóór de vectorkolom.
- Sorteer op `cosineDistance(col, vec)` ascending, niet op `1 - cosineDistance` desc — anders geen index.

## Aanvulling #7 (2026-09-23): spraakpipeline

- **Lokale LiveKit** (geverifieerd op macOS/Docker Desktop): `livekit/livekit-server:v1.13.7` met `--dev --bind 0.0.0.0 --node-ip 127.0.0.1`, poorten 7880/tcp, 7881/tcp, 7882/udp (UDP-mux). Dev-keys `devkey`/`secret`. Zonder `--node-ip` adverteert de server het interne VM-IP (livekit/livekit#3747). Officieel aanbevolen voor lokaal is `brew install livekit`.
- **Turn detector**: `turnHandling.turnDetection` (top-level `turnDetection` is deprecated); `MultilingualModel` ondersteunt Nederlands, heeft de STT-taal nodig (`language: "nl"`) en vraagt eerst `livekit-agents download-files`. De tekstgebaseerde detector logt dat hij deprecated is t.g.v. een audio-EOT-detector (`@livekit/local-inference`).
- **preemptiveGeneration** staat standaard aan en draait `llmNode` speculatief; uitgezet omdat `hear()` onomkeerbare side effects heeft.
- **Barge-in**: LiveKit cancelt de `llmNode`-stream; de brein-kern bewaart een onderbroken beurt met het al gezegde deel.
- **Deepgram**: nova-3 ondersteunt `nl` (sinds aug. 2025); Aura-2 heeft Nederlandse stemmen (`aura-2-beatrix-nl`, `-daphne-nl`, `-cornelia-nl`, `-sander-nl`, `-hestia-nl`, `-lars-nl`, `-roman-nl`, `-rhea-nl`, `-leda-nl`; via docs-samenvatting, niet elk id live getest). TTS streamt (websocket, flush per zin). Bron: https://developers.deepgram.com/docs/tts-models
- **OpenAI-plugin**: STT `gpt-4o-transcribe` vraagt `useRealtime: false`; TTS heeft geen streaming-API — LiveKit wikkelt ze in een `TTSStreamAdapter` (per zin).
- **Data channel (agent-kant)**: `getJobContext().room.localParticipant?.publishData(bytes, { reliable, topic })` (`@livekit/rtc-node` 0.13.x, snake_case `destination_identities`). Browser: `useDataChannel(topic, onMessage)` met `payload: Uint8Array`.
