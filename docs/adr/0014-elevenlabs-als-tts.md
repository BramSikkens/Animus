# ElevenLabs als TTS-provider, Deepgram als terugval

Animus spreekt Nederlands en moet per Dynimo een eigen, expressieve stem kunnen krijgen. Deepgram Aura-2 (9 NL-stemmen) kent geen emotie en geen eigen stem; OpenAI's Node-plugin kan niet streamen; Hume ondersteunt geen Nederlands (zie `docs/research/tts-emotie-catalogus.md`). We kiezen ElevenLabs via `@livekit/agents-plugin-elevenlabs` (versie gelijk aan `@livekit/agents`, 1.9.0) met model Flash v2.5 (`eleven_flash_v2_5`, lage latency, streaming, Nederlands) en `language: "nl"`. Redenen: grote stemcatalogus, Voice Design (stem uit een tekstbeschrijving, #64) en per uiting aanpasbare `voiceSettings`.

**Keuze van provider** (`speechProvider`, alleen TTS): `ELEVENLABS_API_KEY` gezet, dan ElevenLabs; anders `DEEPGRAM_API_KEY`, dan Deepgram; anders OpenAI. STT blijft ongewijzigd (Deepgram, of OpenAI zonder key). Zonder ElevenLabs-key verandert er dus niets en draaien tests zonder netwerk. De plugin leest zelf `ELEVEN_API_KEY`; wij geven `ELEVENLABS_API_KEY` expliciet mee.

**Stemprofiel**: `dynimos.voice` blijft het stem-id van de actieve provider; nieuw is `voice_description` (vrije tekst, input voor Voice Design). De agent zet de stem via `tts.updateOptions` bij start, wissel en `voice:`-notify. Default-stem: `ELEVENLABS_DEFAULT_VOICE_ID`, anders de eerste van de startlijst in `voice.ts` (Rachel).

**Emotie** wordt in #63 per uiting gestuurd via `voiceSettings` (stability/style) op Flash. v3-audiotags vallen af: v3 heeft geen WebSocket-streaming en de Node-plugin ondersteunt het niet. De stemcatalogus (Voice Library, Voice Design) volgt in #64; de startlijst is bewust statisch.
