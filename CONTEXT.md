# Animus

Animus is een AI-robotje dat Dynimo's huisvest: wezentjes met elk een wisselbaar brein, een groeiend geheugen en een zelfgekozen, evoluerend karakter, uitgedrukt via een monochroom gezichtje en spraak.

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
De lopende conversatie van de huidige sessie, letterlijk meegegeven aan Type2. Verdwijnt bij herstart en wanneer de Dynimo gaat slapen.
_Avoid_: context, chatgeschiedenis

**Herinnering**:
Eén opgeslagen, afgeronde beurt (uiting van de Gesprekspartner + antwoord) met een embedding en een Indruk, of iets dat Animus expliciet moest onthouden. Blijft bewaard over herstarts heen; Type2 krijgt vóór elk antwoord de meest relevante herinneringen uit eerdere sessies mee.
_Avoid_: memory (in proza), log

**Indruk**:
Een score (0–1) die Type1 per uiting geeft voor hoe vormend die is voor de Dynimo (een expliciet verzoek zoals "praat wat minder" = hoog, gewone babbel = laag). Bewaard bij de Herinnering; de Reflectie weegt ermee, binnen haar grens.
_Avoid_: prioriteit, urgentie, gewicht

**Langetermijngeheugen**:
Het geheel van alle Herinneringen van één Dynimo (tabel `memories`). Wordt hard gewist bij verwijderen.
_Avoid_: database, archief (dat is het Grafschrift)

### Identiteit

**Dynimo**:
Eén wezentje dat in Animus leeft, van genesis tot dood, met een eigen naam, Langetermijngeheugen, persoonlijkheid en Drijfveren. Er kunnen er meerdere bestaan; ze weten niet van elkaars bestaan en delen niets. Meervoud: Dynimo's.
_Avoid_: wezen, robotje, identiteit, creature

**Wakker / Slapend**:
De twee toestanden van een levende Dynimo. Hooguit één Dynimo is wakker en praat via het gezichtje; alle anderen slapen. Na een herstart van Animus slapen ze allemaal. Slapen is een toestand binnen een draaiend Animus, geen gestopt proces. Laten slapen triggert een Reflectie en wist het Werkgeheugen; de Herinneringen blijven. Bij het wekken begint de Stemming bij wat de laatste Reflectie klaarzette.
_Avoid_: aan/uit, actief/inactief

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

**Kernkarakter**:
De karakterbeschrijving die Type2 bij genesis kiest, het temperament. Verandert nooit.
_Avoid_: basiskarakter, persoonlijkheid

**Geëvolueerd karakter**:
Vrije tekst naast het Kernkarakter, die elke Reflectie in kleine stappen herschrijft op basis van wat de Dynimo meemaakte.
_Avoid_: groei, nieuw karakter

**Persoonlijkheid**:
Het MBTI-type van een Dynimo, afgeleid uit vier assen (I↔E, S↔N, T↔F, J↔P) die elk een getal van 0 tot 1 zijn; de letter volgt uit de kant van het midden. De assen verschuiven traag via Reflecties. Spraakzaamheid volgt uit de I↔E-as.
_Avoid_: karakter (dat is de vrije tekst), Big Five

**Drijfveer**:
Iets wat een Dynimo wil of niet wil, van één van vier soorten: Wens, Doel (kan bereikt of opgegeven worden), Toekomstdroom of Ergernis (zonder waarde of sterkte). Kleurt welke Emotie een uiting oproept.
_Avoid_: voorkeur, interesse; een Toekomstdroom is geen Droom (de nachtelijke droomtekst)

**Reflectie**:
Een Type2-verwerking van recente ervaringen die het geëvolueerde karakter, de persoonlijkheidsassen en de Drijfveren van een Dynimo bijstelt, telkens met een grens op hoeveel er mag verschuiven. Draait wanneer de Dynimo gaat slapen, en bij lange stilte terwijl hij wakker is; dat laatste is zichtbaar aan het gezichtje (reflecterend), maar zegt de Gesprekspartner iets, dan antwoordt de Dynimo gewoon en loopt de Reflectie op de achtergrond verder.
_Avoid_: samenvatting, evaluatie; niet te verwarren met de Afscheidsreflectie

**Droom** (fase 2b):
Een korte, associatieve tekst die Type2 genereert als onderdeel van de Reflectie-bij-het-slapen, op basis van recente Herinneringen, Drijfveren en Persoonlijkheid. Bewaard in een eigen tabel, zeldzaam aangehaald in gesprek. Overschrijft de Ontwaakstemming enkel als hij intenser is dan wat de Reflectie anders zou klaarzetten.
_Avoid_: niet te verwarren met een Toekomstdroom (een Drijfveer, geen nachtelijke tekst)

### Expressie

**Emotie**:
Een vaste, eindige categorie uit de set {blij, boos, verrast, kalm, verveeld, nieuwsgierig, bang, neutraal}. Elke Emotie heeft in de Stemming altijd een waarde van 0 tot 100. Type1 levert per uiting per Emotie een delta (positief of negatief) die de waarde verschuift; vanaf fase 2 is dat hoe de Dynimo zich bij de uiting voelt (met zijn Drijfveren en persoonlijkheid als context), niet de emotie van de Gesprekspartner. Een delta verschuift enkel de Stemming; ze wordt zelf niet getoond.
_Avoid_: sentiment

**Stemming**:
De emotionele toestand van een Dynimo die over beurten heen blijft hangen: een vector met voor elke Emotie een waarde 0–100, plus een tijdstip. De Type1-delta's van een uiting worden opgeteld en geclampt op 0–100; tussendoor dooft elke waarde exponentieel uit naar haar ruststand (halveringstijd 3 minuten). De zichtbare, dominante Emotie is de hoogste waarde (bij gelijkstand de Basisemotie, anders de eerste in de set); het gezichtje en de toon van Type2 volgen die. Zie [ADR-0012](docs/adr/0012-stemming-als-vector.md).
_Avoid_: humeur, emotie (voor de blijvende toestand)

**Basisemotie**:
De Emotie die in de ruststand van de Stemming op 30 staat, terwijl alle andere Emoties op 0 rusten; de Stemming dooft er dus naartoe uit. Bij genesis door Type2 gekozen als deel van het temperament en daarna vrijwel onveranderlijk.
_Avoid_: default-emotie, rustemotie

**Emotiekeyframe**:
De visuele definitie van één emotie: oogvorm/scale/pupil-offset, mondkromming (bezier), achtergrondkleur en, voor een subset van emoties (verrast, boos, bang), een wenkbrauwstand — de overige emoties gebruiken een neutraal-rechte wenkbrauw. Bij een emotiewissel wordt hiertussen getweend.
_Avoid_: expressie-state, animatie (te generiek)

**Weergavetoestand** (fase 2b):
De niet-emotionele modus van het gezichtje, los van de Emotiekeyframes: *slapend*, *wakker*, *luisterend* (de Gesprekspartner praat), *spreekt* (de Dynimo praat) of *reflecterend*. Bepaalt welke animatielaag toont, niet welke emotie. *Luisterend*/*spreekt* volgen LiveKit's ingebouwde `AgentState`/`UserState`; *reflecterend*/*slapend* zijn eigen logica. Zie [ADR-0011](docs/adr/0011-weergavetoestand-gemengde-bron.md).
_Avoid_: mode, view-state, display-state (in proza toegestaan, niet als term)

**Idle-animatie** (fase 2b):
De continue microbeweging (knipperen, ademhaling, pupilverschuiving, subtiele wenkbrauwbeweging) die in elke Weergavetoestand blijft doorlopen, los van een Emotiekeyframe-wissel — zodat het gezicht nooit stilstaat. Tijdens *spreekt* stuurt de audio van de Dynimo bovendien de mondbeweging.
_Avoid_: ademhaling (dat is er één onderdeel van), micro-animatie
