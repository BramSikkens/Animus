# BullMQ + Redis voor achtergrondtaken, uitgevoerd door één worker-proces

Tot fase 3 draaide het zware achtergrondwerk in het proces dat het aanvroeg. De Reflectie liep bij slapen en wisselen mee in `sleepAll` (dus ook in een server action van het dashboard, die op de Type2-call wachtte), en bij stilte in de agent. Een Herinnering opslaan was fire-and-forget in de beurt, en een mislukte embed ging enkel naar de log. De backfill blokkeerde `pnpm dev` bij het opstarten en hield alles tegen bij een fout. Er waren geen retries, en een herstart gooide lopend werk weg.

**Besluit.** Achtergrondtaken lopen via BullMQ op Redis (docker-compose, enkel op 127.0.0.1).
- **Via de wachtrij:** Reflectie (slaap en stilte), backfill, Herinnering opslaan.
- **Niet via de wachtrij:** de beurt zelf en het stemontwerp. Daar wacht iemand live op het resultaat, en een wachtrij voegt enkel latency toe.
- **Eén queue** (`animus`); de jobs onderscheiden zich op naam, met getypeerde payloads in `packages/brain/src/jobs.ts`.
- **Uitvoering:** enkel `apps/worker` voert de jobs uit, met een eigen brain-instantie. Agent, dashboard en CLI's plannen alleen in. `pnpm dev` start de worker mee; bij Ctrl-C maakt hij lopende jobs af en sluit hij zijn verbindingen.
- **Retry/backoff:** standaard 5 pogingen, exponentieel vanaf 2 s (`DEFAULT_JOB_OPTIONS`). Na de laatste poging wordt de fout gelogd; niets anders breekt.
- **Deduplicatie** waar nodig via een vaste job-id (bv. hoogstens één Reflectie per Dynimo tegelijk).
- **Versie:** BullMQ 5.x, omdat die ioredis nog als gewone dependency meebrengt (vanaf 6.x een optionele peer).

**Afgewezen.**
- Een node-cron-taak of `setInterval` in de apps: geen retries, en het werk blijft vastzitten aan het proces dat het aanvraagt.
- Een Postgres-gebaseerde queue (bv. pg-boss): kan, maar Animus.md koos vanaf het begin BullMQ + Redis voor fase 3, en Redis is een kleine container naast de bestaande.
