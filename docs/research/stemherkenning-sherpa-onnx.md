# Onderzoek: sherpa-onnx speaker identification als vervanger voor Picovoice Eagle

Datum: 2026-09-29. Bronnen zijn geciteerd per bewering. Naast documentatie/GitHub bevat dit onderzoek een **eigen meting** (smoke test op macOS arm64, dit ontwikkelapparaat, niet op de Raspberry Pi, met vier van de beschikbare modellen en drie testsprekers uit `k2-fsa`'s eigen testdata, alle Mandarijn-sprekend). Die metingen zijn expliciet als zodanig gemarkeerd; het is een steekproef van n=3 sprekers, geen gevalideerde EER, en géén Nederlandse spraak.

Context: de huidige adapter zit achter `apps/agent/src/speaker-id.ts` (`SpeakerId`-interface: `identify(pcm: Int16Array) => {personId, score} | null`, `enroll(personId, pcm) => Promise<"bezig"|"klaar"|"opgegeven">`, `reload()`, `dispose()`) en wordt ingevuld door `apps/agent/src/eagle-speaker-id.ts`. `apps/agent/src/speaker-audio.ts` levert de PCM aan als **16 kHz, mono, Int16Array**, gebufferd tot maximaal `MAX_BUFFER_MS = 10_000` (10 s). `bestMatch()` in `speaker-id.ts` is een pure functie die, gegeven een score per profiel en de bijbehorende `personId`, het beste Persoon-boven-drempel bepaalt over hoogstens 5 profielen per Persoon (`packages/db/src/schema.ts`).

## 1. npm-pakket

- **Native addon**: `sherpa-onnx-node`, laatste versie **1.13.8** (gepubliceerd 2026‑09‑10), licentie **Apache-2.0**. Het hoofdpakket heeft **geen runtime-`dependencies`**; de platform-binaries komen mee via `optionalDependencies`: `sherpa-onnx-win-x64`, `sherpa-onnx-win-ia32`, `sherpa-onnx-linux-x64`, `sherpa-onnx-darwin-x64`, `sherpa-onnx-linux-arm64`, `sherpa-onnx-darwin-arm64` (elk `^1.13.8`). npm/pnpm installeert automatisch alleen het pakket dat bij het huidige platform past. ([npm registry sherpa-onnx-node](https://registry.npmjs.org/sherpa-onnx-node/latest), eigen registry-opvraging 2026‑09‑29)
  - `sherpa-onnx-darwin-arm64@1.13.8` bestaat (34,1 MB uitgepakt); `sherpa-onnx-linux-arm64@1.13.8` bestaat (40,3 MB uitgepakt) — beide **prebuilt**, dus geen eigen build-toolchain nodig op macOS arm64 én Linux/arm64 (Raspberry Pi 5 is `aarch64`/`linux-arm64`). Geen apart glibc/musl-onderscheid in de pakketnaam — **niet met een `strings`/`GLIBC_`-symboolcheck op de `.so` bevestigd**, enkel afgeleid uit het ontbreken van een aparte musl-variant.
  - **Eigen meting (macOS arm64, deze Mac)**: `npm install sherpa-onnx-node@1.13.8` installeerde zonder compilatie meteen een werkende `sherpa-onnx-darwin-arm64` met `sherpa-onnx.node`; geen `node-gyp`/Xcode-stap nodig. **`require('sherpa-onnx-node')` laadde ook zonder dat `DYLD_LIBRARY_PATH` gezet was** — het officiële voorbeeld-README schrijft die stap wel voor (zie §7), maar was hier niet nodig. Getest met npm, niet met pnpm binnen de Animus-monorepo zelf.
  - **Geen TypeScript-typings**: `package.json` van `sherpa-onnx-node@1.13.8` heeft **geen `types`-veld**, en de tarball bevat geen `.d.ts` — enkel `types.js` met JSDoc-`@typedef`s. Voor TypeScript moet je zelf ambient types schrijven.
  - **CJS, geen native ESM-export**: `main` is `sherpa-onnx.js`, CommonJS. **Eigen meting**: in `.mjs` faalt `import { SpeakerEmbeddingExtractor } from 'sherpa-onnx-node'` hard (`SyntaxError: Named export 'SpeakerEmbeddingExtractor' not found`). De **default import werkt**: `import sherpa from 'sherpa-onnx-node'; sherpa.SpeakerEmbeddingExtractor` is een functie. In het ESM-project van Animus (`"type": "module"`) dus altijd de default-vorm gebruiken.
- **WASM-variant**: `sherpa-onnx` (zonder `-node`), eveneens **1.13.8**, Apache-2.0, ook zonder `types`-veld. De native addon ligt voor de hand voor een Node-agent op een Pi; de node-addon-examples-README vermeldt dat de WASM-route (`nodejs-examples`) geen multi-thread-support heeft, in tegenstelling tot de native addon-route (`nodejs-addon-examples`) — een aanwijzing, geen expliciete benchmark, dat WASM voor CPU-zware inferentie het zwakkere pad is. ([nodejs-addon-examples README](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md))

## 2. API voor speaker ID in Node.js

Bron: primaire broncode van de JS-wrapper (`scripts/node-addon-api/lib/speaker-identification.js`) en de C++-implementatie erachter (`harmony-os/SherpaOnnxHar/.../speaker-identification.cc`, kern in `sherpa-onnx/csrc/speaker-embedding-manager.cc`), plus het officiële voorbeeld `nodejs-addon-examples/test_speaker_identification.js`. Alle drie van `k2-fsa/sherpa-onnx@master`, en de kernclaims hieronder zijn met een eigen script herhaald. ([lib/speaker-identification.js](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/scripts/node-addon-api/lib/speaker-identification.js), [csrc/speaker-embedding-manager.cc](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/sherpa-onnx/csrc/speaker-embedding-manager.cc), [test_speaker_identification.js](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/nodejs-addon-examples/test_speaker_identification.js))

### `SpeakerEmbeddingExtractor` (embedding berekenen)
```js
const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: './model.onnx', numThreads: 1, debug: true });
extractor.dim;                                 // number, embedding-dimensie
const stream = extractor.createStream();       // OnlineStream
extractor.isReady(stream);                     // boolean
stream.inputFinished();                        // bestaat, aanroepbaar (overerft van OnlineStream)
extractor.compute(stream, enableExternalBuffer?);  // -> Float32Array, SYNCHROON
```
- `compute()` alleen (dus zonder `createStream`/`acceptWaveform`/`inputFinished` erbij) is een **synchrone** native call (`addon.speakerEmbeddingExtractorComputeEmbedding(...)`), geen Promise — bevestigd door timing rond enkel die aanroep (zie §4).
- `stream.acceptWaveform({ sampleRate, samples })` verwacht `samples: Float32Array`. **Eigen meting**: een `Int16Array` (rauwe PCM) omgezet naar `Float32Array` via `sample/32768` en dan teruggezet naar Int16 en wéér gedeeld door 32768, gaf een cosinus van **1,0000** tegen het origineel op alle vier geteste modellen — de conversie zelf is dus lossless genoeg voor deze toepassing. Los daarvan, met dezelfde samples **ongenormaliseerd** (rauwe Int16-waardes, dus ±32000 i.p.v. ±1) doorgegeven: op `wespeaker_en_voxceleb_resnet34_LM.onnx` gaf dat een cosinus van slechts **0,60** tegen de genormaliseerde versie — dat model is dus schaalgevoelig en normalisatie is nodig. Op de twee 3D-Speaker-modellen die zijn getest (CAM++ en ERes2Net) gaf dezelfde vergelijking **1,0000** — schaal-onafhankelijk in deze test, vermoedelijk doordat hun fbank-front-end intern al normaliseert. **Niet aannemen dat normalisatie voor elk model optioneel is; wél altijd `int16/32768` toepassen, want het kost niets en is voor minstens één model verplicht.**
- **Eigen meting**: `isReady()` bleef `true`, zowel vóór als na `inputFinished()`, voor testclips van 0,3 s tot 5,6 s — geen merkbare harde ondergrens in de API zelf.

### `SpeakerEmbeddingManager` (registreren/vergelijken) — **kritieke bevinding, verandert het ontwerp**
```js
const manager = new sherpa.SpeakerEmbeddingManager(extractor.dim);
manager.add({ name, v: Float32Array });                 // 1 embedding
manager.addMulti({ name, v: Float32Array[] });           // meerdere embeddings → GEMIDDELD tot 1 vector
manager.search({ v, threshold });        // -> string: naam, of "" — GEEN score
manager.verify({ name, v, threshold });  // -> boolean — ook geen score
manager.remove(name); manager.contains(name); manager.getNumSpeakers(); manager.getAllSpeakerNames();
```
Uit de primaire C++-bron (`SpeakerEmbeddingManager::Impl`):
- **`Add(name, embedding_list)` (waarnaar `addMulti` mapt) middelt de meegegeven embeddings tot één genormaliseerde vector per naam** (`v += ...; v.normalize();`) — er is **geen manier om, zoals nu met Eagle's "max 5 profielen per Persoon", meerdere losse embeddings per Persoon te bewaren binnen de Manager**.
- **`Search`/`Verify` retourneren geen score**, enkel naam/boolean. De C++ *kern* heeft wél `GetBestMatches(p, threshold, n)` en `Score(name, p)`, maar die zijn **niet naar de Node-addon geëxporteerd** (nagegaan in de exports-lijst van `speaker-identification.cc`: alleen `Add`, `AddListFlattened`, `Remove`, `Search`, `Verify`, `Contains`, `NumSpeakers`, `GetAllSpeakers`). ([harmony-os/.../speaker-identification.cc](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/speaker-identification.cc))
  - Een `GetEmbedding`-methode is toegevoegd via [PR #3950](https://github.com/k2-fsa/sherpa-onnx/pull/3950), samengevoegd **2026‑09‑14** — dus **na** npm-publicatie 1.13.8 (2026‑09‑10); nog niet op npm op onderzoeksdatum. Verandert niets aan het ontbreken van scores bij `search`/`verify`, of aan het middel-gedrag van `addMulti`.
- **Conclusie**: `SpeakerEmbeddingManager` past niet op de bestaande `bestMatch()`-architectuur. Voor de hand liggend ontwerp: **gebruik alléén `SpeakerEmbeddingExtractor.compute()`**, bewaar zelf tot 5 losse Float32-embeddings per Persoon (zoals nu Eagle's `export()`-bytes), en reken de score zelf als cosinus-similarity (dot product van L2-genormaliseerde vectoren) uit — dat sluit direct aan op de bestaande, ongewijzigde `bestMatch()`.

## 3. Modellen (release `speaker-recongition-models`, gepubliceerd 2023‑12‑08)

Volledige lijst met exacte bestandsgroottes, via de GitHub Releases API opgehaald: ([release-pagina](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models), [GitHub API](https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/speaker-recongition-models))

| Familie | Bestand | Grootte | Taal/dataset |
|---|---|---|---|
| 3D-Speaker CAM++ | `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx` | 28,2 MB | Engels (VoxCeleb) |
| 3D-Speaker CAM++ | `3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx` | 27,0 MB | Mandarijn |
| 3D-Speaker CAM++ | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 27,0 MB | Mandarijn + Engels |
| 3D-Speaker ERes2Net | `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` | 37,8 MB | Mandarijn |
| 3D-Speaker ERes2Net | `3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx` | 37,8 MB | Mandarijn |
| 3D-Speaker ERes2Net | `3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx` | 110,7 MB | Mandarijn |
| 3D-Speaker ERes2Net | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | 25,3 MB | Engels (VoxCeleb) |
| 3D-Speaker ERes2Net | `3dspeaker_speech_eres2net_sv_zh-cn_16k-common.onnx` | 210,4 MB | Mandarijn |
| 3D-Speaker ERes2NetV2 | `3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx` | 68,1 MB | Mandarijn |
| NeMo | `nemo_en_speakerverification_speakernet.onnx` | 22,3 MB | Engels |
| NeMo TitaNet | `nemo_en_titanet_small.onnx` / `..._large.onnx` | 38,4 / 96,7 MB | Engels |
| WeSpeaker CAM++ | `wespeaker_en_voxceleb_CAM++.onnx` / `..._LM.onnx` | 27,9 MB | Engels (VoxCeleb) |
| WeSpeaker ResNet | `wespeaker_en_voxceleb_resnet34.onnx` / `..._LM.onnx` | 25,3 MB | Engels (VoxCeleb) |
| WeSpeaker ResNet | `wespeaker_en_voxceleb_resnet152/221/293_LM.onnx` | 75,5 / 90,6 / 109,0 MB | Engels (VoxCeleb) |
| WeSpeaker ResNet | `wespeaker_zh_cnceleb_resnet34.onnx` / `..._LM.onnx` | 25,3 MB | Mandarijn (CN-Celeb) |

Er is **geen model getraind op Nederlandse spraak**; de keuze staat tussen Engels (VoxCeleb), Mandarijn (3D-Speaker/CN-Celeb) en één gemengd Mandarijn+Engels model. VoxCeleb's eigen projectpagina claimt brede diversiteit ("speech from speakers spanning a wide range of different ethnicities, accents, professions and ages"), maar zegt niets specifiek over taal — de opnames zijn overwegend Engelstalige interviews. ([VoxCeleb-projectpagina, Oxford VGG](https://www.robots.ox.ac.uk/~vgg/data/voxceleb/))

**Eigen meting, vier modellen op drie Mandarijn-sprekende testsprekers uit `k2-fsa`'s eigen testdata** (embedding-dim tussen haakjes; genuine = cosinus tussen uitingen van dezelfde spreker, impostor = tussen verschillende sprekers):

| Model | dim | min genuine | max impostor | marge |
|---|---|---|---|---|
| `wespeaker_en_voxceleb_resnet34_LM.onnx` (en) | 256 | 0,884 | 0,863 | ~0,02 |
| `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx` (en) | 512 | 0,576 | 0,886 | negatief (overlap) |
| `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` (zh+en) | 192 | 0,666 | 0,439 | ~0,23 |
| `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` (zh-cn) | 512 | 0,648 | 0,282 | ~0,37 |

**Interpretatie, met een confound expliciet benoemd**: op deze (Mandarijn-sprekende) testdata scheiden de twee modellen die Mandarijn in hun trainingsdata hebben (zuiver zh-cn, en het gemengde zh+en-model) duidelijk beter dan de twee zuiver-Engelse modellen — dat is consistent met "taalovereenkomst tussen trainingsdata en gebruikers telt". Maar er zijn twee confounds die dit niet los bevestigen: (1) het zh-cn-model is precies de model/testdata-combinatie die het officiële sherpa-onnx-voorbeeld zelf gebruikt, dus mogelijk de best-geteste combinatie; (2) WeSpeaker's eigen scoringmethode trekt een cohort-gemiddelde af vóór de cosinus (`Scoring: cosine (sub mean of vox2_dev)`, zie §"Nauwkeurigheid" hieronder) — die stap zit niet in de kale `.onnx`+eigen-cosinus-aanpak die deze agent zou gebruiken, wat de matige marge van het WeSpeaker-ResNet34-model deels kan verklaren los van taal. **Conclusie: er is hier geen hard bewijs dat taal de enige of dominante factor is, maar de gemeten marges bevestigen wel dat geen van de modellen zonder eigen kalibratie op Nederlandse spraak vertrouwd kan worden**, en dat het gemengde zh+en-model en het zh-cn-model in deze steekproef merkbaar beter scheidden dan de zuiver-Engelse modellen.

### Nauwkeurigheid (EER) — primaire bronnen, met de juiste tabelrij
- **WeSpeaker ResNet34-TSTP-emb256, met large-margin fine-tuning (LM), zónder AS-Norm/QMF**: EER op VoxCeleb1‑O **0,797 %**. Met AS-Norm (geen QMF): 0,723 %; met AS-Norm+QMF: 0,659 % (de vaak geciteerde waarde). **Let op**: zelfs de "zonder AS-Norm/QMF"-rij is niet exact gelijk aan "kale `.onnx` + eigen cosinus" — de WeSpeaker-recepten scoren steeds met "cosine (sub mean of vox2_dev)", dus met een cohort-gemiddelde vooraf afgetrokken; dat gebeurt niet als je zelf, zoals hier voorgesteld, rechtstreeks cosinus op de ruwe embeddings neemt. De echte EER van "kale `.onnx` + pure cosinus, geen mean-subtractie" is in dit onderzoek niet apart gevonden. ([WeSpeaker VoxCeleb v2 recipe README, wenet-e2e/wespeaker@master](https://raw.githubusercontent.com/wenet-e2e/wespeaker/master/examples/voxceleb/v2/README.md), regel 4: "Scoring: cosine (sub mean of vox2_dev), AS-Norm, QMF")
- **WeSpeaker CAM++, met LM, zonder AS-Norm/QMF**: EER op VoxCeleb1‑O **0,707 %** (zelfde caveat over mean-subtractie). Dit betreft WeSpeaker's **eigen** CAM++-checkpoint (`wespeaker_en_voxceleb_CAM++_LM.onnx`), niet de hierboven geteste 3D-Speaker/ModelScope-checkpoints — die zijn andere trainingsruns van dezelfde architectuurfamilie, waarvoor in dit onderzoek geen aparte primaire EER is gevonden.
- **3D-Speaker-architectuurvergelijking** (eigen trainingsrecepten van 3D-Speaker, niet noodzakelijk dezelfde bestanden als de sherpa-onnx-release): EER op VoxCeleb1‑O: ERes2Net-large 0,52 % / CAM++ 0,65 % / ERes2NetV2 0,61 % / ERes2Net-base 0,84 % / ResNet34 1,05 % — met 6–9 % EER op de Chinese CN-Celeb/3D-Speaker-testsets voor diezelfde modellen. ([modelscope/3D-Speaker README](https://github.com/modelscope/3D-Speaker/blob/main/README.md))
- **Eigen, aanvullende (crude) test**: het aftrekken van het gemiddelde van de 7 in dit onderzoek berekende embeddings (circulair bij zo weinig data, puur ter oriëntatie) verbeterde de marge van het zh+en-model niet aantoonbaar boven de sowieso-al-goede rauwe marge, en verslechterde die van ResNet34 juist (min genuine daalde tot ‑0,016, max impostor tot ‑0,004 — ruisniveau). Dit weerlegt niet dat een échte cohort-gemiddelde-aftrek (over veel meer sprekers) zou kunnen helpen, maar met n=7 is dit geen bruikbaar bewijs in beide richtingen.

## 4. Prestaties (rekentijd)

**Eigen meting, macOS arm64 (deze Mac — geen Pi-cijfer), `numThreads: 1`, timing rond `compute()` alleen:**

| Model | dim | Audio | `compute()`-tijd |
|---|---|---|---|
| wespeaker_resnet34_LM (en) | 256 | 2,3 s | 122 ms |
| wespeaker_resnet34_LM (en) | 256 | 4,2 s | 207 ms |
| 3dspeaker_campplus (en) | 512 | 2,3 s | 35 ms |
| 3dspeaker_campplus (en) | 512 | 4,2 s | 59 ms |
| 3dspeaker_campplus_zh_en_advanced | 192 | 2,3 s | 39 ms |
| 3dspeaker_campplus_zh_en_advanced | 192 | 4,2 s | 64 ms |
| 3dspeaker_eres2net_base (zh-cn) | 512 | 2,3 s | 94 ms |
| 3dspeaker_eres2net_base (zh-cn) | 512 | 4,2 s | 168 ms |

ResNet34 is op deze Mac merkbaar trager dan de CAM++-varianten (~3× bij vergelijkbare audioduur) — consistent met CAM++'s kleinere FLOPs-budget in WeSpeaker's eigen tabel (CAM++ 1,15 GFLOPs vs ResNet34 4,55 GFLOPs). ([WeSpeaker README-tabel](https://raw.githubusercontent.com/wenet-e2e/wespeaker/master/examples/voxceleb/v2/README.md))

- Er is **geen officieel gepubliceerd Raspberry Pi/arm64-benchmarkcijfer** voor speaker-embedding specifiek gevonden; de projectbeschrijving vermeldt algemene Raspberry Pi-ondersteuning voor de bibliotheek als geheel. ([k2-fsa/sherpa-onnx README](https://github.com/k2-fsa/sherpa-onnx))
- Een Raspberry Pi 5 (Cortex-A76 @ 2,4 GHz) is doorgaans meerdere keren trager dan Apple-Silicon voor dit soort single-thread CPU-inferentie; een factor 3–6× op de bovenstaande cijfers is een **niet-geverifieerde aanname**.
- **Relevant voor de architectuur van deze agent**: `compute()` is synchroon en blokkeert de Node-event-loop. `speaker-audio.ts` buffert tot `MAX_BUFFER_MS = 10_000` (10 s); bij 10 s audio en het (tragere) ResNet34-model zou dat op deze Mac al ~0,5–0,6 s blokkerende rekentijd per `identify()`-aanroep betekenen, en op een Pi 5 potentieel een veelvoud daarvan — zie Open punten. De CAM++-varianten (~15–16 ms/s audio op deze Mac) zijn hier veel gunstiger.

## 5. Inschrijven en drempel

- **Geen vaste minimale opnameduur gedocumenteerd.** In eigen metingen bleef `isReady()` `true` voor clips vanaf 0,3 s; de officiële voorbeelddata gebruikt uitingen van 2,3–5,6 s. Er is geen sherpa-onnx-equivalent van Eagle's `minEnrollmentChunks`. ([test_speaker_identification.js](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/nodejs-addon-examples/test_speaker_identification.js), eigen smoke test)
- **Meerdere embeddings middelen of los bewaren**: het officiële voorbeeld gebruikt `addMulti()` met 2–3 uitingen per spreker, maar (§2, primaire C++-bron) `addMulti` **middelt** die tot één vector — bewaart ze niet los. Voor deze agent (tot 5 losse profielen per Persoon, net als nu) is het gepaste patroon: **niet** `SpeakerEmbeddingManager.addMulti` gebruiken, maar per enroll-beurt één `compute()`-embedding zelf opslaan als los profiel (max 5), en zelf het maximum over die profielen nemen bij `identify()` — het patroon dat `bestMatch()` al implementeert.
- **Drempel in het officiële voorbeeld: cosinus-drempel `0,6`**, met het taalgepaarde model `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` op Mandarijn-sprekers. ([test_speaker_identification.js](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/nodejs-addon-examples/test_speaker_identification.js))
- **Eigen meting toont dat deze 0,6 geen universele default is, en dat de juiste drempel sterk per model verschilt** (zie tabel in §3): op `eres2net_base_zh-cn` en `campplus_zh_en_advanced` is er een duidelijke marge (impostors resp. onder 0,282 en 0,439, genuine resp. boven 0,648 en 0,666) — een drempel rond 0,5–0,6 zou daar goed werken. Op `wespeaker_resnet34_LM` (en) en zeker op `campplus` (en, zuiver Engels) is de marge nihil of negatief — daar werkt géén vaste drempel goed op deze testdata.
  - **Consequentie**: `DEFAULT_SPEAKER_MATCH_THRESHOLD = 0.5` (nu voor Eagle's eigen schaal) kan niet zomaar hergebruikt worden, en er is **geen drempel-startwaarde die voor alle sherpa-onnx-modellen zou werken** — de drempel moet per gekozen model, en met echte Nederlandse opnames van het huishouden, empirisch bepaald worden (zie Aanbeveling voor een voorlopig startpunt).

## 6. Modelbestand distribueren

- Het model is een los `.onnx`-bestand, te downloaden van de GitHub-release `speaker-recongition-models`; de release bevat een `checksum.txt` voor integriteitscontrole van alle bestanden. ([release-assets via GitHub API](https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/speaker-recongition-models))
- **Het bestaande `pnpm agent:download`-patroon is niet direct herbruikbaar.** In `package.json` (root) is dat `pnpm --filter @animus/agent download-files`, en in `apps/agent/package.json` is `download-files` het commando `livekit-agents download-files` — een ingebouwd commando van de `@livekit/agents`-CLI dat alleen bestanden ophaalt die de geïnstalleerde LiveKit-plugins zelf registreren (bv. Silero VAD, turn-detector). sherpa-onnx-modellen zijn daar niet bij. Er is momenteel **geen modellenmap en geen generiek downloadmechanisme** in dit project buiten dat CLI-commando (nagegaan: geen `.pv`/model-bestanden buiten `apps/dashboard` in de repo). Een sherpa-onnx-model vereist dus een **nieuwe, eigen download-stap** (bv. een klein script met `curl`/`fetch` naar de release-URL plus checksum-verificatie tegen `checksum.txt`) — niet aan te passen aan bestaande infrastructuur, wel nieuw te bouwen naar analogie ervan.

## 7. Valkuilen / open issues

- **Geen TypeScript-typings** (bevestigd, §1); een verwante, openstaande wens voor typehints bestaat voor de Python-binding: [issue #2228](https://github.com/k2-fsa/sherpa-onnx/issues/2228) (open) — wijst erop dat typings project-breed geen prioriteit hebben.
- **`DYLD_LIBRARY_PATH`/laadproblemen op macOS, mogelijk pnpm-specifiek.** Het officiële `nodejs-addon-examples`-README schrijft voor om vóór gebruik `DYLD_LIBRARY_PATH` (macOS) of `LD_LIBRARY_PATH` (Linux) te zetten naar de map van het platform-specifieke binary-pakket, met een omslachtiger pnpm-variant van dat pad omdat pnpm packages isoleert. **Eigen meting weerspreekt dit deels**: op deze Mac laadde `require('sherpa-onnx-node')` ook **zonder** die variabele — maar dat is met npm getest, niet binnen de geneste pnpm-structuur van de Animus-monorepo, dus het risico is niet uitgesloten voor de daadwerkelijke deploy. Gerelateerd, bevestigd probleem in de praktijk: [issue #2622](https://github.com/k2-fsa/sherpa-onnx/issues/2622) (closed, "Failed to load sherpa-onnx-node in Electron on macOS due to DYLD_LIBRARY_PATH issues (likely SIP)"); packaging-poging: [issue #2451](https://github.com/k2-fsa/sherpa-onnx/issues/2451) (open). Een docs-toevoeging specifiek voor pnpm-gebruikers staat als [PR #1401](https://github.com/k2-fsa/sherpa-onnx/pull/1401) — deze staat op GitHub als **closed** (niet apart bevestigd of dat een merge was of een sluiting zonder merge).
- **`SpeakerEmbeddingManager` mist tot voor kort readback/score-functionaliteit** (§2): `GetEmbedding` is er pas sinds [PR #3950](https://github.com/k2-fsa/sherpa-onnx/pull/3950) (gemerged 2026‑09‑14, nog niet in npm 1.13.8 van 2026‑09‑10) — en zelfs die voegt geen score toe aan `search`/`verify`. Reden om de Manager hier niet te gebruiken (zie Aanbeveling).
- **Recente, nog niet in een release verwerkte regressies op macOS arm64** in andere onderdelen van de node-addon-API (niet specifiek speaker-ID, maar een signaal van algemene addon-instabiliteit rond ONNX-Runtime-updates): [issue #3791](https://github.com/k2-fsa/sherpa-onnx/issues/3791) (open, KeywordSpotter/streaming-ASR kapot op macOS arm64 Apple M4 in 1.13.4 door een ORT 1.27.0 SME-Conv-bug), [issue #3776](https://github.com/k2-fsa/sherpa-onnx/issues/3776) (open, OnlineRecognizer geeft bijna-lege resultaten op sommige macOS-arm64-machines na 1.12.34 → 1.13.4). Niet bevestigd of dit ook de speaker-embedding-extractor raakt; wel een signaal om bij een versie-upgrade de eigen tests opnieuw te draaien.
- **Blokkerende `compute()`-tijd bij lange buffers**: `speaker-audio.ts` buffert tot 10 s audio (`MAX_BUFFER_MS`). Omdat `compute()` synchroon is, kan een volle 10 s-buffer met het tragere ResNet34-model (~55–60 ms/s audio op deze Mac) een merkbare, blokkerende pauze in de event loop geven vóór elke `identify()` — met een CAM++-variant (~15–16 ms/s) is dat veel minder een probleem. Overweeg sowieso het aan `compute()` gegeven audiovenster te begrenzen tot iets korter dan de volle 10 s.
- **Schaal-/normalisatiegevoeligheid verschilt per model** (§2): niet aannemen dat elk sherpa-onnx-speakermodel dezelfde input-conventie hanteert; wél altijd normaliseren, dat kost niets.
- **Sample-rate-mismatch niet getest**: of `acceptWaveform` zelf resamplet wanneer `sampleRate` afwijkt van wat het model verwacht (16 kHz), is niet geverifieerd. De agent levert al 16 kHz aan, dus vermoedelijk geen probleem, maar niet bevestigd.

## Aanbeveling

- **Pakket**: `sherpa-onnx-node@1.13.8` (native addon, niet `sherpa-onnx`/WASM), eigen ambient-`.d.ts`, en een **default import** (`import sherpa from "sherpa-onnx-node"`; named imports werken niet).
- **API**: alleen `SpeakerEmbeddingExtractor.compute()` gebruiken, **geen** `SpeakerEmbeddingManager` (middelt embeddings, geeft geen score terug). Embeddings zelf als bytes opslaan (tot 5 per Persoon, zoals nu Eagle's `export()`), zelf cosinus-similarity berekenen voor de bestaande `bestMatch()`. Altijd `Int16Array → Float32Array` (`/32768`) converteren vóór `acceptWaveform`.
- **Model (voorlopig)**: `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` (192-dim, 27 MB, snelste geteste model op deze Mac: ~15–16 ms rekentijd per seconde audio) — in de eigen test de beste marge (min genuine 0,666, max impostor 0,439) van de niet-taalgepaarde modellen. Dit is een **voorlopige** keuze op basis van drie Mandarijn-sprekende testpersonen, niet Nederlandse spraak; vervang hem zonder aarzelen als een test met echte gezinsleden een ander model beter laat scheiden.
- **Drempel-startwaarde**: **0,55** (net boven de gemeten max-impostor 0,439 van het aanbevolen model, met marge) — expliciet een startpunt, geen eindwaarde. Verplicht kalibreren met opnames van de daadwerkelijke gezinsleden vóór productiegebruik; pas zowel het model als deze drempel aan op basis daarvan.
- **Inschrijfstrategie**: per `enroll()`-beurt één `compute()`-embedding, opslaan als los profiel, tot maximaal 5 per Persoon — geen middeling. Eigen "klaar"-voorwaarde (bv. N geslaagde `compute()`-aanroepen met voldoende samples), want sherpa-onnx dwingt zelf geen minimum-lengte af.

## Open punten

- Rekentijd op de daadwerkelijke Raspberry Pi 5 is niet gemeten (alleen macOS arm64); de vermenigvuldigingsfactor 3–6× is een aanname.
- `DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH`-vereiste is niet getest binnen de pnpm-monorepo-structuur van Animus zelf (alleen met npm in een losse scratch-map, waar het niet nodig was).
- Of `acceptWaveform` zelf resamplet bij een sample-rate-mismatch, is niet bevestigd.
- De exacte minimale betrouwbare uitingslengte (in seconden) is niet door sherpa-onnx gedocumenteerd; `isReady()` dwingt in eigen tests geen praktische ondergrens af, dus dit moet empirisch met Nederlandse spraak bepaald worden.
- **Geen enkel beschikbaar model is op Nederlandse spraak getraind of getest** — de eigen meting gebruikt Mandarijn-sprekende testdata uit de sherpa-onnx-repo zelf. Vóór een definitieve modelkeuze: testen met opnames van de daadwerkelijke gezinsleden. De confounds in §3 (taal vs. testcombinatie-bekendheid vs. WeSpeaker's mean-subtractie-scoring) zijn niet losgetrokken.
- Bestaande Eagle-profielen in `voice_profiles` zijn **niet migreerbaar** naar sherpa-onnx-embeddings (andere modelarchitectuur/embeddingruimte) — een overstap betekent alle Personen opnieuw laten inschrijven.
- Of `sherpa-onnx-linux-arm64` specifiek tegen glibc (i.p.v. musl) gelinkt is, is niet met een symboolcheck bevestigd.
- Of een écht cohort-gemiddelde (over veel enrollments, niet de n=7 uit deze eigen test) de scheiding zou verbeteren zoals bij WeSpeaker's eigen scoring, is niet uitgesloten maar ook niet aangetoond — met n=7 gaf het gemengde resultaten (hielp niet meetbaar bij het aanbevolen model, verslechterde de score bij ResNet34).
- `GetEmbedding` op `SpeakerEmbeddingManager` (PR #3950) is te nieuw om al op npm te staan; irrelevant voor de hier aanbevolen aanpak (die de Manager toch niet gebruikt), maar het volgen waard als sherpa-onnx ooit een node-addon-`GetBestMatches`-equivalent toevoegt — dat zou de eigen cosinus-berekening kunnen vervangen.
