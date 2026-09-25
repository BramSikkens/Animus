# Onderzoek: speaker recognition (Eagle) en face embeddings (Human) voor Personen

Datum: 2026-09-25. Bronnen zijn geciteerd per bewering. Voor Eagle, Human en `@livekit/rtc-node` zijn de type-definities en README's rechtstreeks uit de npm-tarballs gehaald (niet in `node_modules` van dit project geïnstalleerd — dit project heeft nog geen LiveKit-dependency, gecontroleerd via `package.json`/lockfile).

## 1. Picovoice Eagle (speaker recognition) — Node.js

- **Pakket & versie**: `@picovoice/eagle-node`, laatste versie **3.0.1**, licentie **Apache-2.0**, `engines.node >= 18.0.0`. ([npm](https://www.npmjs.com/package/@picovoice/eagle-node), [registry.npmjs.org](https://registry.npmjs.org/@picovoice/eagle-node/latest))
- **Installatie**: `npm install @picovoice/eagle-node` (plus optioneel `@picovoice/pvrecorder-node` als je van een microfoon i.p.v. een bestaande audiostream leest). ([README in de 3.0.1-tarball](https://www.npmjs.com/package/@picovoice/eagle-node))

### EagleProfiler (enrollment) — uit `dist/types/eagle.d.ts` en `types.d.ts` van v3.0.1
- `new EagleProfiler(accessKey: string, options?: EagleProfilerOptions)`. Opties:
  - `modelPath` — pad naar het `.pv`-modelbestand.
  - `device` — `best` / `gpu` / `gpu:${INDEX}` / `cpu` / `cpu:${NUM_THREADS}`.
  - `minEnrollmentChunks` (≥ 1) — minimum aantal chunks voordat `enroll()` 100% teruggeeft; hoger = nauwkeuriger profiel, meer audio nodig. **Dit is het antwoord op "minimale audio-lengte": er is geen vaste seconden-waarde, het is instelbaar via dit aantal chunks × `frameLength`.**
  - `voiceThreshold` (0–1) — gevoeligheid voor stemdetectie tijdens enrollment; hoger = strenger, met kans op gemiste frames.
  - `libraryPath` — pad naar de native `.node`-library.
- `get sampleRate(): number` en `get frameLength(): number` — **getters**, geen methoden. Input voor `enroll()` moet **Int16Array**, 16-bit lineair PCM, single-channel zijn, met exact `frameLength` samples.
- `enroll(pcm: Int16Array): number` — retourneert alleen het **percentage (0–100)** als `number`; er is **geen apart feedback-object of enum** in deze binding (geen `EagleProfilerEnrollFeedback`-type aanwezig in v3.0.1's `.d.ts`-bestanden). Roep dit aan in een lus totdat 100% bereikt is.
- `flush(): number` — markeert het einde van de audiostroom voor deze spreker, flushed interne state, en retourneert het (eind)percentage. **Moet aangeroepen worden voordat je van bron/spreker wisselt.**
- `export(): Uint8Array` — exporteert het voltooide profiel als binair array; gooit een error als het profiel nog niet klaar is (percentage < 100). Exacte bytegrootte niet gedocumenteerd — **niet geverifieerd, meet dit empirisch** (zit typisch in de orde van enkele KB's voor dit type voice-embedding-profielen, maar dat is een aanname, geen bevestigd feit).
- `reset(): void` — wist interne state voor een nieuwe enrollment-sessie (nieuwe spreker).
- `release(): void` — geeft native resources vrij.

### Eagle (recognizer) — uit dezelfde bron
- `new Eagle(accessKey: string, options?: EagleOptions)`. Opties: `modelPath`, `device`, `voiceThreshold`, `libraryPath` (zelfde betekenis als bij de profiler).
- `get sampleRate(): number` en `get minProcessSamples(): number` — **getters**; dit laatste is de gevraagde "frame length" van de recognizer (het minimum aantal samples per `process()`-call), niet noodzakelijk identiek aan `EagleProfiler.frameLength`.
- `process(pcm: Int16Array, speakerProfiles: Uint8Array[] | Uint8Array): number[] | null` — **synchroon**. `speakerProfiles` is precies de `Uint8Array` (of array van meerdere) die `export()` opleverde — **dat is tevens het antwoord op "import": er is geen aparte import-stap, je geeft de rauwe bytes direct mee aan `process()`**. Retourneert een array met similarity-scores **[0.0–1.0]** per profiel (zelfde volgorde als de meegegeven profielen), of `null` als er onvoldoende stem in het frame zat.
- `release(): void`.
- `static listAvailableDevices(options?): string[]`.

### Platform, taal, drempel
- Ondersteunde platforms (README + `.d.ts`): **Linux (x86_64), macOS (x86_64, arm64), Windows (x86_64, arm64), Android, iOS, Chrome/Safari/Firefox/Edge, Raspberry Pi 3/4/5** — macOS arm64 en Raspberry Pi 5 (dus Linux/arm64 op die hardware) zijn dus officieel gedekt. ([Picovoice Eagle GitHub README](https://github.com/Picovoice/eagle), [npm README v3.0.1](https://www.npmjs.com/package/@picovoice/eagle-node))
- Eagle is **"language-agnostic and text-independent"**. ([Picovoice Eagle GitHub](https://github.com/Picovoice/eagle))
- Geen officiële aanbevolen drempel gevonden voor een "zekere" identificatie op de 0–1 similarity-score. De enige gedocumenteerde drempel-parameter is `voiceThreshold` (spraakdetectie-gevoeligheid, geen identificatiedrempel). **Zelf empirisch kalibreren.**

### Licentie / gratis tier / AccessKey
- SDK-licentie: **Apache-2.0**.
- **Gratis tier — tegenstrijdige/onvolledige bronnen, hier expliciet benoemd:**
  - Picovoice's eigen aankondiging (2021, via Hackster.io-samenvatting) noemt een gratis tier tot **3 actieve gebruikers/maand**, "even commercially", maar somt daarbij specifiek **Porcupine, Rhino en Cobra** op — **Eagle wordt niet met naam genoemd** in deze bron. ([Hackster.io](https://www.hackster.io/news/picovoice-launches-completely-free-usage-tier-for-offline-voice-recognition-for-up-to-three-users-e1eafbc97bb0))
  - Een actuele samenvattingsbron (spotsaas.com) beschrijft het Free Plan als bedoeld voor **"individual developers working on personal non-commercial projects"** — dit spreekt de "even commercially"-claim uit de oudere aankondiging tegen. **Deze twee bronnen zijn het dus oneens; geen van beide is de officiële Picovoice-pricingpagina zelf.**
  - De officiële `picovoice.ai/pricing`-pagina kon in dit onderzoek **niet succesvol opgehaald worden** (lege/geblokkeerde response bij herhaalde pogingen) — dit is dus niet met de primaire bron bevestigd.
  - "$6000/mnd" voor betaalde tiers komt van secundaire aggregatorsites, niet van Picovoice zelf — **laag vertrouwen**.
  - Het Eagle GitHub-README spreekt over "trial limits" en dat je bij het overschrijden daarvan contact moet opnemen met **Enterprise Sales** — dit wijst erop dat Eagle mogelijk een aparte/beperktere trial-regeling heeft dan de "3 gratis gebruikers"-regeling van de wake-word-engines. **Niet bevestigd of Eagle specifiek onder de 3-gebruikers-gratis-tier valt.**
  - **Advies**: voordat je hierop bouwt, log in op https://console.picovoice.ai/ en controleer het actuele Eagle-quotum op je eigen account — dat is de enige echt betrouwbare bron.
- **Definitie "gebruiker"**: een "user" is het aantal "dingen" (devices/eindgebruikers) dat de engine daadwerkelijk activeert — niet de Console-accounthouder of developer. ([Picovoice Pricing, via zoekresultaat](https://picovoice.ai/pricing/))
- **AccessKey**: gratis verkrijgbaar via **console.picovoice.ai** met e-mail of GitHub-account. Let op: **AccessKey-validatie vereist internetverbinding**, ook al draait de eigenlijke voice-verwerking volledig offline/on-device — relevant voor een Raspberry Pi die (semi-)offline moet werken. ([Eagle GitHub README](https://github.com/Picovoice/eagle), [npm README](https://www.npmjs.com/package/@picovoice/eagle-node))

## 2. sherpa-onnx speaker identification (Node.js) — alternatief (kort overzicht, zoals gevraagd)

- **npm-pakket**: `sherpa-onnx`, laatste versie **1.13.8**, beschikbaar als native addon-bindings én als WASM Node.js-module. ([npm](https://www.npmjs.com/package/sherpa-onnx), [registry.npmjs.org](https://registry.npmjs.org/sherpa-onnx/latest))
- **Embedding-modellen**: losse, apart te downloaden speaker-embedding-modellen (3D-Speaker/WeSpeaker-varianten), gepubliceerd op de release-pagina `speaker-recongition-models`. ([sherpa-onnx speaker identification docs](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html), [releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models))
- **API-overzicht**: `SpeakerEmbeddingExtractor` berekent een embedding-vector uit PCM-audio ("enroll" = embedding maken + registreren); `SpeakerEmbeddingManager` beheert geregistreerde sprekers via `Register()` (voeg spreker+embedding toe), `Search()` (vind dichtstbijzijnde spreker binnen een threshold = "identify"), `AllSpeakers()`, `Contains()`. Er is ook `OfflineSpeakerDiarization` voor het scheiden van meerdere sprekers binnen één opname. ([DeepWiki k2-fsa/sherpa-onnx Node.js bindings](https://deepwiki.com/k2-fsa/sherpa-onnx/3.9-node.js-bindings-(addon-api-and-wasm)), [sherpa JS API docs](https://k2-fsa.github.io/sherpa/onnx/javascript-api/index.html))
- Concrete Node.js-voorbeeldcode: `nodejs-examples/` en `nodejs-addon-examples/` in de repo (niet in detail doorgenomen — buiten scope van dit overzicht). ([sherpa-onnx nodejs-addon-examples README](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md))

## 3. @vladmandic/human in de browser — face embeddings

- **Laatste versie**: **3.3.6**. ([npm](https://www.npmjs.com/package/@vladmandic/human), [registry.npmjs.org](https://registry.npmjs.org/@vladmandic/human/latest))
- **Standaard-config (uit `src/config.ts` van de 3.3.6-tarball) — wat je moet uitzetten voor "alleen detectie + description"**:
  Standaard staan `body`, `hand`, `gesture` én binnen `face` ook `mesh`, `iris` en `emotion` **aan** (`enabled: true`); `object`, `segmentation`, `face.attention`, `face.antispoof` en `face.liveness` staan standaard al **uit**. Voor puur detectie + embedding zet je dus expliciet uit wat niet nodig is:
  ```js
  const config = {
    face: {
      enabled: true,
      detector: { rotation: false, return: false }, // defaults, aanpasbaar
      mesh: { enabled: false },
      iris: { enabled: false },
      emotion: { enabled: false },
      description: { enabled: true }, // dit is de embedding
    },
    body: { enabled: false },
    hand: { enabled: false },
    gesture: { enabled: false },
    object: { enabled: false },       // staat al standaard uit
    segmentation: { enabled: false }, // staat al standaard uit
  };
  ```
  ([`src/config.ts`, human@3.3.6 npm-tarball](https://registry.npmjs.org/@vladmandic/human/-/human-3.3.6.tgz))
- **Embedding-lengte**: `face.embedding` (het `description`-model, `faceres.json`) is een array van **1024 elementen** (vs. 128 bij het oudere face-api.js). ([vladmandic/human discussion #322](https://github.com/vladmandic/human/discussions/322))
- **Vergelijking & drempel — uit `src/face/match.ts` van de 3.3.6-tarball (primaire bron, geen aanname)**:
  - `distance(d1, d2, options)` berekent standaard **Euclidische afstand** (`order: 2` is default; hogere `order` geeft algemene Minkowski-afstand). Er is **geen ingebouwde cosine-optie** — de bibliotheek gebruikt uitsluitend Minkowski/Euclidisch.
  - `similarity(d1, d2, options)` normaliseert die afstand naar een 0–1-score. Defaults: `{ order: 2, multiplier: 25, min: 0.2, max: 0.8 }`.
  - `find(descriptor, descriptors, options)` zoekt de dichtstbijzijnde match in een array descriptors; default `threshold: 0` (vroegtijdig stoppen bij afstand 0), zelfde order/multiplier/min/max defaults.
  - De code-comments zeggen: met de gebruikte multiplier/normalisatie is een **similarity boven 0.5 (50%)** te beschouwen als match — dit is dus een door de auteur zelf gedocumenteerde vuistregel, direct uit de broncode.
- **Modellen laden**: `modelBasePath` is standaard een lege string; volgens de inline documentatie in `config.ts` wordt bij lege/relatieve paden in de browser automatisch teruggevallen op de **jsDelivr CDN**, terwijl `wasmPath` (voor de WASM-backend) hetzelfde auto-detect-naar-jsdelivr-gedrag heeft. Voor Node.js is de default `file://models/`. Voor productie is expliciet zelf hosten (eigen `modelBasePath` naar een eigen modellenmap, bv. uit het losse `@vladmandic/human-models`-pakket) de gedocumenteerde aanbeveling om niet afhankelijk te zijn van een externe CDN. ([`src/config.ts`](https://registry.npmjs.org/@vladmandic/human/-/human-3.3.6.tgz), [npm human-models](https://www.npmjs.com/package/@vladmandic/human-models))
- **Bundelen met Vite / bekende issues**:
  - Human bundelt standaard zijn eigen TFJS-kopie; bij een eigen TFJS-import in het project ontstaan versieconflicten — gebruik dan de **`-nobundle`-variant**. ([vladmandic/human Wiki Issues](https://github.com/vladmandic/human/wiki/Issues))
  - `tfjs-backend-wasm` heeft generieke (niet Human-specifieke) bundler-problemen: modulebundelaars laden de `.wasm`-binary niet altijd correct; werkt wel via een losse `<script>`-tag. ([tensorflow/tfjs issue #4217](https://github.com/tensorflow/tfjs/issues/4217))
  - Server-side bundelen (bv. binnen een Next.js-build) kan misgaan doordat de bundler het browser/Node-doelplatform niet altijd correct detecteert. ([vladmandic/human Wiki Issues](https://github.com/vladmandic/human/wiki/Issues))
  - **Backend**: default is `webgl` in de browser, `tensorflow` (native) in Node.js — bevestigd in `config.ts`-commentaar, geen losse benchmark gevonden voor "alleen detectie+description"; dit laatste is **niet geverifieerd**, zelf meten.
- **Samen met `@mediapipe/tasks-vision`**: geen documentatie gevonden die dit expliciet afraadt of bevestigt — **niet geverifieerd**. Beide zijn onafhankelijke libraries die elk hun eigen WASM/GPU-runtime laden; aandachtspunt is resourcedruk (twee zware WASM-bundels, mogelijk gedeelde WebGL-context), praktisch testen aanbevolen.

### Opslag in pgvector
- Kolomdimensie: **`vector(1024)`** voor Human's `face.embedding`.
- **Metriek — aangepast op basis van de primaire bron (`match.ts`)**: Human's eigen `similarity()`/`find()` gebruiken standaard **Euclidische (L2) afstand**, geen cosine. Als de applicatie dezelfde ranking wil opleveren als `human.match.similarity`, is **`<->` (L2) in pgvector de metriek die daarbij aansluit**, niet `<=>` (cosine) — tenzij je zelf weet dat de descriptor L2-genormaliseerd is (dat is in dit onderzoek niet bevestigd; Human normaliseert de rauwe afstand pas ná berekening, niet de vector zelf, dus er is geen aanwijzing dat de 1024-d vector unit-length is). Cosine (`<=>`) is pas de betere keuze als je zelf de vector normaliseert vóór opslag én een eigen cosine-drempel kalibreert los van Human's `similarity()`-schaal. ([pgvector distance functions uitleg, algemene achtergrond](https://medium.com/@philmcc/pgvector-distance-functions-cosine-vs-l2-vs-inner-product-d5609c7e39b4), [`src/face/match.ts`, human@3.3.6](https://registry.npmjs.org/@vladmandic/human/-/human-3.3.6.tgz))

## 4. LiveKit Node — ruwe audio van een remote participant lezen

- **Versies**: dit project heeft nog geen LiveKit-dependency (gecontroleerd: geen `livekit` in `package.json`/lockfile van Animus). Actuele npm-registry-versies: `@livekit/rtc-node` **1.1.0** en `@livekit/agents` **1.9.0**. ([registry.npmjs.org rtc-node](https://registry.npmjs.org/@livekit/rtc-node/latest), [registry.npmjs.org agents](https://registry.npmjs.org/@livekit/agents/latest))
  - **Let op**: de opdracht noemde `@livekit/rtc-node 0.13.x`; die versie is niet meer de "latest" op npm. Onderstaande API is geverifieerd tegen de **1.1.0**-tarball (`dist/audio_stream.d.ts`, `dist/audio_frame.d.ts`). Bevestig bij implementatie welke versie het project daadwerkelijk vastpint, en check de `.d.ts` van die exacte versie als die afwijkt van 1.1.0.
- **`AudioStream`** (`dist/audio_stream.d.ts`, v1.1.0) — **extends de standaard Web `ReadableStream<AudioFrame>`** (geen eigen custom class):
  ```ts
  class AudioStream extends ReadableStream<AudioFrame> {
    constructor(track: Track);
    constructor(track: Track, sampleRate: number);
    constructor(track: Track, sampleRate: number, numChannels: number);
    constructor(track: Track, options: AudioStreamOptions);
  }
  interface AudioStreamOptions {
    noiseCancellation?: NoiseCancellationOptions | FrameProcessor<AudioFrame>;
    autoCloseNoiseCancellation?: boolean;
    sampleRate?: number;
    numChannels?: number;
    frameSizeMs?: number;
  }
  ```
  Voor 16 kHz mono t.b.v. Eagle: `new AudioStream(track, { sampleRate: 16000, numChannels: 1 })`. Omdat het een `ReadableStream` is, itereer je met `for await (const frame of audioStream) { ... }` (Node's WHATWG streams ondersteunen `Symbol.asyncIterator`). Of LiveKit intern resamplet naar de opgegeven sampleRate/numChannels, of dat de bron-track al in die rate moet zitten, is **niet expliciet in de `.d.ts` gedocumenteerd** — alleen dat de opties geaccepteerd worden; dit is een aanname die je moet verifiëren bij implementatie.
- **`AudioFrame`** (`dist/audio_frame.d.ts`, v1.1.0):
  ```ts
  class AudioFrame {
    data: Int16Array;
    sampleRate: number;
    channels: number;
    samplesPerChannel: number;
  }
  ```
  Dit `Int16Array`-formaat sluit direct aan op wat Eagle's `enroll()`/`process()` verwachten (mits sample rate/frameLength overeenkomen — eventueel frames zelf bufferen/opsplitsen tot Eagle's exacte `frameLength` resp. `minProcessSamples`).
- **In een `@livekit/agents`-agent**: de interface `agents.voice.RoomInputOptions` heeft o.a. `audioEnabled`, `audioSampleRate`, `audioNumChannels` waarmee je op sessieniveau al 16 kHz mono kunt vragen. Voor rauwe toegang tot een specifieke remote participant buiten de ingebouwde STT-pipeline om, luister je op `RoomEvent.TrackSubscribed` en maak je daar zelf een `AudioStream` voor die track (zoals hierboven). ([RoomInputOptions reference](https://docs.livekit.io/reference/agents-js/interfaces/agents.voice.RoomInputOptions.html), [LiveKit agents audio/video docs](https://docs.livekit.io/agents/build/media/), receive-audio voorbeeld in [livekit/node-sdks](https://github.com/livekit/node-sdks))

## Openstaande / niet-geverifieerde punten
- Exacte bytegrootte van een geëxporteerd Eagle-profiel (`export()`).
- Of Eagle specifiek onder Picovoice's gratis "3 actieve gebruikers"-tier valt, of een eigen (mogelijk beperktere) trial-regeling heeft — de officiële pricingpagina kon niet succesvol opgehaald worden; controleer dit op je eigen Picovoice Console-account.
- Of `@livekit/rtc-node`'s `AudioStream` zelf resamplet naar de opgegeven `sampleRate`/`numChannels`, of dat de bron al in die rate moet zitten.
- Gedrag van Human en `@mediapipe/tasks-vision` naast elkaar op dezelfde pagina (gedeelde WebGL/WASM-resources) — niet gedocumenteerd, testen aanbevolen.
- Exacte performance van Human met alleen detectie+description ingeschakeld — niet gebenchmarkt in dit onderzoek.
