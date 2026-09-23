# Onderzoek fase 1: Jev, AI SDK v7, LiveKit Agents, Drizzle + pgvector

Stand 2026-09-23. Geverifieerd door de npm-tarballs te lezen (`.d.ts`/bron); webbronnen enkel waar vermeld.

## Jev (TypeSafe "System One Model") — Type1

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
