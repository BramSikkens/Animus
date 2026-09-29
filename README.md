# Animus

Animus is een AI-robotje dat **Dynimo's** huisvest: wezentjes met elk een wisselbaar brein, een groeiend geheugen en een zelfgekozen, evoluerend karakter. Ze praten Nederlands, tonen emoties op een monochroom gezichtje, zien je via de camera en herkennen je aan gezicht en stem.

Dit is het softwareprototype, dat op je eigen computer draait. Later volgt een port naar een Raspberry Pi met motoren, camera en schermpje. De volledige visie staat in [Animus.md](Animus.md), de domeintaal (Dynimo, Stemming, Vertrouwdheid, Gesprekspartner, …) in [CONTEXT.md](CONTEXT.md).

## Hoe het in elkaar zit

| Onderdeel | Wat |
|---|---|
| `packages/core` | De kern: de Animus (`createAnimus`), die de Dynimo's beheert en de wakkere laat leven; Type1 (snelle reflex-classificatie) en Type2 (het redenerende LLM-brein, wisselbaar via de Vercel AI SDK), geheugen, karakter, Stemming, Personen |
| `packages/db` | Drizzle-schema en migraties voor PostgreSQL met pgvector |
| `packages/protocol` | Berichten tussen agent en gezichtje over LiveKit (topics, berichttypes, validatie) |
| `apps/agent` | LiveKit-agent: spraak in en uit (VAD, STT, TTS), stem- en gezichtsherkenning, en de Animus in-process |
| `apps/face` | Het gezichtje (Vite + React): ogen, mond en wenkbrauwen, Galerij van Dynimo's, perceptie in de browser (MediaPipe, Human) |
| `apps/dashboard` | Beheer (Next.js): Dynimo's, Herinneringen, Personen samenvoegen, stemmen |
| `apps/worker` | Voert achtergrondtaken uit (BullMQ + Redis, zie [ADR-0022](docs/adr/0022-bullmq-redis-voor-achtergrondtaken.md)) |
| `apps/cli` | Terminal-tools: repl, verwijder, slaap-allen, backfill |

Architectuurbeslissingen staan in [docs/adr](docs/adr).

## Vereisten

- Node.js 23 of nieuwer en [pnpm](https://pnpm.io) 10
- Docker (voor PostgreSQL/pgvector, Redis en een lokale LiveKit-server)
- API-sleutels: minstens één LLM-provider (OpenAI of Anthropic) en de Vercel AI Gateway voor Type1; optioneel Deepgram (STT) en ElevenLabs (TTS). Stemherkenning gebruikt sherpa-onnx (lokaal model via `pnpm agent:download`), geen API-sleutel nodig.

## Opstarten

```bash
pnpm install
```

```bash
cp .env.example .env && chmod 600 .env
```

Vul in `.env` minstens `TYPE2_LIGHT_MODEL`/`TYPE2_HEAVY_MODEL` in (formaat `provider:model`, bv. `openai:…` of `anthropic:…`), plus de bijbehorende sleutel en `AI_GATEWAY_API_KEY`. Elke variabele staat toegelicht in [.env.example](.env.example).

Download eenmalig de modellen voor de turn-detectie van de agent:

```bash
pnpm agent:download
```

Start alles (databank, Redis en LiveKit via Docker, daarna agent, worker, gezichtje en dashboard):

```bash
pnpm dev
```

- Gezichtje: http://localhost:5173
- Dashboard: http://127.0.0.1:3001

Een nieuwe Dynimo krijg je via de Galerij in het gezichtje of via het dashboard. Bij zijn geboorte kiest hij zelf zijn naam, karakter en stem.

## Handige commando's

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm repl
```

```bash
pnpm kiosk
```

`pnpm test` draait alle tests; de core-tests maken daarvoor een wegwerp-database `animus_test` aan in de Docker-Postgres. `pnpm repl` praat in de terminal met de wakkere Dynimo, zonder spraak.

## Kiosk

`pnpm kiosk` opent het gezichtje schermvullend in Chrome of Chromium (kiosk-mode, zonder adresbalk), met camera/microfoon/autoplay al toegestaan. De dev-server moet al draaien (`pnpm dev` of `pnpm face`); zonder draaiende server, of zonder gevonden Chrome/Chromium, stopt het script met een duidelijke melding. Op macOS vraagt het systeem de eerste keer nog één keer toestemming voor camera en microfoon voor Chrome zelf. Afsluiten: Cmd+Q. Toestemmingen en de Galerij-keuze staan in een eigen profielmap (`~/.animus-kiosk`, buiten de repo) — verwijder die map om ze te resetten. Hetzelfde script werkt op Linux (bv. de Pi in fase 4) met Chromium.

## Beveiliging

Animus is een lokale dev-opzet zonder authenticatie. Het dashboard, het gezichtje, PostgreSQL en LiveKit luisteren enkel op localhost. De LiveKit-agent aanvaardt commando's en camerabeelden alleen van de eigen deelnemer (identity `eigenaar-…`), en valt nooit terug op de dev-sleutels tegen een niet-lokale LiveKit-server. Zet het niet ongewijzigd op een publieke server.

Camerabeelden en audio worden niet bewaard: enkel gezichts-embeddings en stemprofielen gaan naar de databank.

## Licentie

[MIT](LICENSE)
