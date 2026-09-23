# Animus

Animus is een AI-robotje met een wisselbaar brein, een groeiend geheugen en een zelfgekozen, evoluerend karakter, uitgedrukt via een monochroom gezichtje en spraak.

## Language

### Brein

**Type1**:
Het snelle, goedkope reflex-brein (via Jev) dat typed classificaties/beslissingen teruggeeft zonder taalgeneratie — sub-100ms.
_Avoid_: reflex-brein, System One (in proza toegestaan, niet als term)

**Type2**:
Het langzame, redenerende LLM-brein (wisselbaar via de Vercel AI SDK) voor gesprek, planning, tool-gebruik en oordeel over nieuwe situaties.
_Avoid_: praat-brein, System Two

**Intent**:
De Type1-classificatie van een uiting als *simpel* (begroeting, kort praatje, eenvoudige vraag) of *complex* (uitleg, redenering, planning, oordeel). Bepaalt of Type2-licht of Type2-zwaar antwoordt.
_Avoid_: complexiteit, moeilijkheidsgraad

### Geheugen

**Gesprekspartner**:
De persoon die met Animus praat. In Fase 1 is er één: de eigenaar.
_Avoid_: gebruiker, user

**Werkgeheugen**:
De lopende conversatie van de huidige sessie, letterlijk meegegeven aan Type2. Verdwijnt bij herstart.
_Avoid_: context, chatgeschiedenis

**Herinnering**:
Eén opgeslagen, afgeronde beurt (uiting van de Gesprekspartner + antwoord) met een embedding, of iets dat Animus expliciet moest onthouden. Blijft bewaard over herstarts heen; Type2 krijgt vóór elk antwoord de meest relevante herinneringen uit eerdere sessies mee.
_Avoid_: memory (in proza), log

**Langetermijngeheugen**:
Het geheel van alle Herinneringen van één wezen (tabel `memories`). Wordt hard gewist bij verwijderen.
_Avoid_: database, archief (dat is het Grafschrift)

### Identiteit

**Seed**:
Een random startpunt, getrokken uit een curated woordenlijst, dat Type2 tijdens de genesis-flow gebruikt om zelf een naam en karakter te kiezen. Wordt samen met het resultaat in het `identity`-record bewaard.
_Avoid_: prompt, karaktertrekjes (dat is het resultaat, niet de seed zelf)

**Leeftijd**:
De kalendertijd sinds `born_at` — loopt door tijdens uitgeschakelde periodes. Zie [ADR-0002](docs/adr/0002-leeftijd-kalendertijd.md).
_Avoid_: uptime, actieve tijd

**Grafschrift**:
Het kleine archief (naam, leeftijd, laatste woorden) dat bewaard blijft na volledige verwijdering van een `identity`-record, enkel leesbaar voor de eigenaar. Zie [ADR-0003](docs/adr/0003-verwijderen-bewaart-grafschrift.md).
_Avoid_: backup, export

**Afscheidsreflectie**:
De "laatste woorden" in het grafschrift: een aparte, finale Type2-call vlak vóór verwijdering, niet de meest recente bestaande reflectie/droom.
_Avoid_: laatste reflectie (dat suggereert hergebruik van een bestaande)

### Expressie

**Emotie**:
Een vaste, eindige categorie uit de set {blij, boos, verrast, kalm, verveeld, nieuwsgierig, bang, neutraal}, met een intensiteit (0–1), die Type1 per uiting aflevert.
_Avoid_: sentiment, stemming (als los begrip)

**Emotiekeyframe**:
De visuele definitie van één emotie: oogvorm/scale/pupil-offset, mondkromming (bezier), achtergrondkleur en, voor een subset van emoties (verrast, boos, bang), een wenkbrauwstand — de overige emoties gebruiken een neutraal-rechte wenkbrauw. Bij een emotiewissel wordt hiertussen getweend.
_Avoid_: expressie-state, animatie (te generiek)
