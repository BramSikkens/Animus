# TTS: emotie, stemcatalogus, eigen stem (research, 2026-09-24)

Context: LiveKit Agents Node, huidig `@livekit/agents-plugin-deepgram` + `-openai` 1.9.0 (apps/agent/package.json), taal NL.
Markering: [F] = feit uit bron, [I] = eigen interpretatie, [?] = niet geverifieerd.

| | ElevenLabs | OpenAI gpt-4o-mini-tts | Cartesia Sonic 3.6 | Hume Octave | Deepgram Aura-2 |
|---|---|---|---|---|---|
| Node-plugin | ja, `@livekit/agents-plugin-elevenlabs` | ja (al geinstalleerd) | ja, `@livekit/agents-plugin-cartesia` | **nee** (alleen Python) | ja (huidig) |
| Env | `ELEVEN_API_KEY` | `OPENAI_API_KEY` | `CARTESIA_API_KEY` | `HUME_API_KEY` | `DEEPGRAM_API_KEY` |
| Streaming in plugin | ja (WebSocket multi-stream), maar **niet voor v3** | **nee**: `stream()` gooit error, alleen chunked `synthesize()` | ja (WebSocket, hergebruikt) | n.v.t. | ja |
| Per-uiting wijzigen | `updateOptions({voiceId, voiceSettings, model, language})` | `updateOptions({model, voice, speed})`; `instructions` alleen bij constructie | `updateOptions({voice, emotion, speed, volume, language, model})` zonder reconnect | n.v.t. | `updateOptions({model,...})` |
| Emotie | v3 audio tags (`[whispers]`, `[excited]`, `[crying]`), stability-slider | vrije tekst `instructions` | `emotion` (60+, 6 primair: neutral, calm, angry, content, sad, scared), per request | `description` (Py); Octave 2 acting instructions "coming soon" | geen |
| NL | v3 70+ talen, Flash v2.5 32 talen (NL incl. [I]) | ja [?] kwaliteit niet bron-geverifieerd | `nl` in sonic-3/3.5/3.6 | **NL niet ondersteund** (Octave 2: 11 talen zonder NL) | ja, 9 NL-stemmen, geen emotie |
| Latency | Flash ~75ms, v3 Conversational ~280ms | hoog; niet echt streaming | Sonic laagste klasse [?] geen cijfer geverifieerd | Octave 2 ~100ms | laag |
| Prijs (indicatief) | Flash $0.05/1K tekens, v3 $0.10/1K | ~$0.015/min | ~$5-49 per 1M tekens (credits, per plan) | ~$7.60 per 1M (tracker) | $30 per 1M tekens |
| Eigen stem | Voice Design (tekst -> stem), IVC, PVC (Creator+) | nee (vaste stemmen; custom voices enterprise [?]) | Instant clone (10-60s audio, single language), Pro clone (30+ min); voice design uit tekst niet gevonden in docs | design uit beschrijving + clone (15s) | nee |
| Catalogus | Voice Library 10.000+ community-stemmen | ~13 vaste stemmen [?] | eigen catalogus, 8 stemmen met sterkste emotie | eigen | 9 NL |

## Kernpunten
- **ElevenLabs + LiveKit Node**: default `eleven_turbo_v2_5`; plugin-broncode toont geen v3-support. v3 heeft geen WebSocket/multi-context; LiveKit issues #3904 en #4901 [F]. Audio tags werken dus waarschijnlijk niet real-time via de Node-plugin. [?] Controleer laatste agents-js release. `enableSsmlParsing` bestaat als optie. Emotie kan wel via `voiceSettings` (stability/style) per uiting met Flash/Turbo, zwakker dan v3-tags.
- **Cartesia** is de enige met: Node-plugin + echte streaming + emotie per uiting + NL + cloning. Emotie werkt alleen als consistent met de tekst.
- **OpenAI**: instructions goed stuurbaar, maar Node-plugin kan niet streamen (elke zin volledig gegenereerd; hogere latency), en `instructions` niet via updateOptions (nieuwe TTS-instantie per uiting nodig [I]).
- **Hume**: geen Node-plugin en geen NL: valt af.
- **Deepgram**: goedkoop/snel, maar geen emotie, geen eigen stem.

## Juridisch (filmkarakters)
- ElevenLabs Use Policy verbiedt de stem van een persoon repliceren "without consent or legal right"; fictieve-karakter-uitzondering geldt alleen voor content-inhoud (geweld e.d.), niet voor stem-imitatie [F: elevenlabs.io/use-policy].
- [I] Stem van een acteur/bestaande film-figuur klonen of "klinkt als" = risico (persoonlijkheids-/portretrecht, merk, ToS). Veilig: eigen ontworpen archetypes (oude man, kind, wijze vrouw) via Voice Design, of stemmen met duidelijke licentie uit Voice Library. Alleen PVC kan publiek gedeeld worden; IVC/generated voices niet [F].

## Aanbeveling
1. **Cartesia Sonic 3.6** als hoofdroute: `@livekit/agents-plugin-cartesia`, emotie per uiting via `updateOptions({emotion})`, NL, streaming, goedkoop, eigen clone.
2. **ElevenLabs Flash v2.5** (Node-plugin) als alternatief voor Voice Design/karakterstemmen; v3-tags pas na check van plugin-support.
3. Deepgram houden als goedkope fallback; OpenAI alleen als niet-streaming fallback. Hume schrappen.
4. Eerst NL-luistertest Cartesia vs ElevenLabs Flash (kwaliteit en emotie in NL niet primair geverifieerd).

## Bronnen
- https://docs.livekit.io/agents/models/tts/
- https://docs.livekit.io/agents/models/tts/elevenlabs/
- https://docs.livekit.io/agents/models/tts/cartesia/
- https://docs.livekit.io/agents/models/tts/hume/
- https://docs.livekit.io/agents/models/tts/openai/
- https://raw.githubusercontent.com/livekit/agents-js/main/plugins/{elevenlabs,cartesia,openai}/src/tts.ts
- geinstalleerde plugin: node_modules/.pnpm/@livekit+agents-plugin-{openai,deepgram}@1.9.0*/.../src/tts.ts
- https://github.com/livekit/agents/issues/3904 , https://github.com/livekit/agents/issues/4901
- https://elevenlabs.io/docs/overview/models , /docs/api-reference/text-to-voice/design , /docs/overview/capabilities/voices , /docs/overview/capabilities/text-to-speech/best-practices , https://elevenlabs.io/pricing/api , https://elevenlabs.io/use-policy
- https://docs.cartesia.ai/build-with-cartesia/tts-models , /sonic-3/volume-speed-emotion , /capability-guides/clone-voices
- https://dev.hume.ai/docs/text-to-speech-tts/overview
- https://developers.deepgram.com/docs/tts-models
- Prijzen (secundair, tracker-sites): texttolab.com/blog/{cartesia,deepgram,openai-tts}-pricing, cloudprice.net/models/hume-octave-2
