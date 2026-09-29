# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Eén gebruiker: de maker van Animus (Bram). Hij zit aan zijn laptop naast het draaiende gezichtje (`apps/face`) en gebruikt het dashboard tijdens experimenten, soms op een smaller venster ernaast.

## Product Purpose
Het dashboard is de binnenkant van de Dynimo's: je ziet hoe ze evolueren (Stemming, karakter, Persoonlijkheid, Verstand, Vertrouwdheid, Herinneringen, Drijfveren, Dromen, welk Type2-model schreef) en je stuurt bij waar nodig (wekken en slapen, nieuw leven, Stemming of assen forceren, Personen samenvoegen, stemmen kiezen, het model wisselen, doden). Het werkt als het goed is wanneer de maker in één oogopslag ziet wat er in een Dynimo omgaat en snel kan ingrijpen zonder te zoeken.

## Positioning
Geen generiek admin-paneel. Dit is het venster op het innerlijk leven van één specifiek wezen dat een eigen karakter kiest en evolueert. Het hoort bij dezelfde wereld als het monochrome gezichtje.

## Operating Context
- Lokaal, zonder authenticatie, enkel op 127.0.0.1:3001 (Host-controle in `proxy.ts`, #108).
- Next 16 (App Router, server actions in `app/actions.ts`, formulierfeedback via `action-form.tsx`/ActionState), dezelfde Postgres als de agent, de Animus via `lib/animus.ts`.
- Wijzigingen bereiken het gezichtje live via NOTIFY op het toestandskanaal.
- Zware taken (Reflectie, backfill, Herinnering opslaan) lopen via de worker (ADR-0022); dashboard-acties keren meteen terug.

## Capabilities and Constraints
- Taal: Nederlands, met de domeintaal uit CONTEXT.md (Dynimo, Wakker/Slapend, Stemming, Persoonlijkheid, Verstand, Vertrouwdheid, Herinnering, Drijfveer, Droom, Persoon, Grafschrift, Archetype, Reflectie).
- Pagina's: Overzicht, Dynimo (per id), Personen, Stemmen, Model, Grafschriften.
- Stemontwerp en klonen kosten ElevenLabs-tegoed; dat moet vóór de actie zichtbaar zijn.
- Destructieve acties (doden, Persoon verwijderen, samenvoegen, Herinnering verwijderen) vragen bevestiging.

## Brand Commitments
- Zelfde wereld als het gezichtje: rustig, warm, monochroom (gezichtje: `#111`-achtergrond, `#f4efe3` crème).
- Licht en donker volgen het systeem.

## Evidence on Hand
Echte data uit de lokale databank (Dynimo's, Personen, Herinneringen). Geen verzonnen voorbeelden in de UI.

## Product Principles
- Eerst zien, dan ingrijpen: de toestand van een Dynimo staat bovenaan, bediening daaronder.
- Elke bestaande functie blijft bereikbaar; herontwerp verwijdert geen mogelijkheden.
- De taal van het domein, niet van de database.
- Rust boven drukte: één wezen tegelijk centraal.
