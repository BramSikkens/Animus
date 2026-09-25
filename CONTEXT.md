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

**Spontane herinnering**:
Een oude, vormende Herinnering waar de Dynimo zelf op terugkomt ('Je zei vorige week dat je ziek was, ben je beter?'). Pure kiezer `pickSpontaneousMemory` (`recall-spontaneous.ts`): alleen Herinneringen ouder dan 1 dag met Indruk ≥ 0.5 en niet aangehaald in de laatste 7 dagen (kolom `memories.last_recalled_at`), gewogen op Indruk × ouderdom; de kans schaalt met F (T↔F) en expressiviteit. Bij een initiatief-moment (hoge basiskans) gaat de Herinnering in de initiatief-instructie mee naar Type2; in een normale beurt (heel lage basiskans) als optionele aanleiding in de systeem-prompt. Pas na de voltooide beurt gemarkeerd als aangehaald.
_Avoid_: terugval, flashback

**Langetermijngeheugen**:
Het geheel van alle Herinneringen van één Dynimo (tabel `memories`). Wordt hard gewist bij verwijderen.
_Avoid_: database, archief (dat is het Grafschrift)

### Identiteit

**Dynimo**:
Eén wezentje dat in Animus leeft, van genesis tot dood, met een eigen naam, Langetermijngeheugen, persoonlijkheid en Drijfveren. Er kunnen er meerdere bestaan; ze weten niet van elkaars bestaan en delen niets. Meervoud: Dynimo's.
_Avoid_: wezen, robotje, identiteit, creature

**Galerij**:
Het startscherm van het gezichtje: zodra de pagina laadt verbindt hij zelf (zonder microfoon) en toont een raster van vierkanten, één per levende Dynimo, met naam, leeftijd en een slapend miniatuurgezichtje; een wakkere Dynimo heeft een klein lichtstipje. Onder elk vierkant staan 'Wek'/'Laat slapen' en 'Dood' (vraagt, net als de CLI, de exacte naam ter bevestiging). Een laatste vierkant 'Tot leven wekken' laat een nieuwe Dynimo geboren worden (zoals in het dashboard: hij is meteen wakker en de rest slaapt); tijdens de geboorte klopt er een lichtbolletje, en de pasgeborene groeit uit een lichtbol open, doet zijn ogen open en opent daarna vanzelf zijn gezicht (microfoon aan). Klikken kiest die Dynimo: hij wordt gewekt (als hij dat niet al is), de microfoon gaat aan en zijn gezicht verschijnt zodra hij als wakker gepubliceerd is ('Wakker worden…' tot dan). 'Terug' laat hem slapen, zet de microfoon uit en toont de Galerij weer; wordt hij elders slapend gelegd, dan valt de face ook terug op de Galerij. Omgekeerd: wordt een Dynimo elders gewekt (dashboard, 'Wek') terwijl de face in de Galerij staat, dan opent zijn gezicht vanzelf en gaat de microfoon aan. Onder de levenden staat een sectie 'In memoriam' met gedempte grafvierkanten (kaarsje, naam, leeftijd bij overlijden, en de Afscheidsreflectie in een uitklap); ze zijn niet klikbaar om te wekken. De agent publiceert de lijst (id, naam, wakker, geboortedatum) plus de laatste 50 Grafschriften (`graves`; de agent leest de tabel zelf, het brein nooit) en ontvangt birth/wake/sleep/kill-commando's van het gezichtje (dev-only, zonder auth, gevalideerd in de agent); de Galerij volgt live het dashboard.

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

**Archetype**:
Een vooringesteld karakterpatroon (bv. schattig wezentje, robot, lieve oude dame, professor) met zes assen, Basisemotie, spreekstijl-instructies voor Type2 en een stemomschrijving. Bij genesis kiest Type2 altijd één uit een gevarieerd aanbod van vier; geeft hij een id buiten het aanbod (onbekend, leeg of niet aangeboden), dan kiest de rng er een aangeboden. Assen en Basisemotie worden daaruit voorgezet. Bestaande Dynimo's met `archetype = null` blijven zoals ze zijn (het dashboard kan er een zetten). Bewaard bij de Dynimo; in het dashboard te wijzigen, wat assen en Basisemotie opnieuw als startpunt zet — geen pinning, de assen schuiven daarna vrij.
_Avoid_: rol, persona, type (dat is Type1/Type2)

**Persoonlijkheid**:
Het MBTI-type van een Dynimo, afgeleid uit vier assen (I↔E, S↔N, T↔F, J↔P) die elk een getal van 0 tot 1 zijn; de letter volgt uit de kant van het midden. Daarnaast twee losse assen (0–1, standaard 0.5, buiten het MBTI-type): **reactiviteit** (hoe hard Emoties bewegen: schaalt de Type1-delta's en de uitdoofsnelheid van de Stemming) en **expressiviteit** (hoeveel emotie in taal, stem en gezicht doorschemert). Alle zes verschuiven traag via Reflecties en zijn instelbaar in het dashboard. Type2 krijgt per as-uiteinde concrete gedragsregels (sterk vanaf <0.25 / >0.75, zacht vanaf <0.4 / >0.6, daartussen niets); spraakzaamheid volgt uit de I↔E-as. Bij expressiviteit < 0.4 laat de stemmingsprompt Type2 zijn stemming niet benoemen (geen 'wees eerlijk'-regel), zodat hij de gesloten-regel niet tegenspreekt. Het gezicht volgt de expressiviteit-as: de getoonde intensiteit wordt met (0.5 + expressiviteit) vermenigvuldigd (geklemd op 1, `faceIntensity`); de balkjes tonen de ware waarden. Zie [ADR-0013](docs/adr/0013-reactiviteit-en-expressiviteit.md).
_Avoid_: karakter (dat is de vrije tekst), Big Five

**Vertrouwdheid**:
Een getal van 0 tot 1 per Dynimo (start op 0.2) voor hoe vertrouwd de relatie met de Gesprekspartner is. Het stijgt langzaam en asymptotisch bij elke beurt en extra bij positieve emoties (blij-delta), en daalt bij een genegeerde beurt en bij een Reflectie na lange stilte (nooit onder 0.05); de Persoonlijkheid (T↔F en expressiviteit) schaalt de groeisnelheid. Vier banden (afstandelijk, vriendelijk, vertrouwd, intiem) geven Type2 een toonregel: van beleefd en formeel ('u' mag, afhankelijk van archetype en karakter) tot bijnamen en plagen. Instelbaar in het dashboard. Zie [ADR-0016](docs/adr/0016-vertrouwdheid-als-aparte-schaal.md).
_Avoid_: vertrouwen, band, zevende as

**Verstand**:
Een getal van 0 tot 1 per Dynimo voor hoeveel hij weet, hoe goed hij redeneert en hoe wereldwijs hij is — los van *hoe* hij praat (dat bepalen Archetype en Persoonlijkheid): een Dromer met hoog Verstand klinkt zweverig maar zegt kloppende, doordachte dingen. Bij genesis gezet vanuit een richtwaarde van het Archetype met een brede willekeurige spreiding, zodat wezentjes de norm blijven maar er af en toe een denker ontwaakt. Laag Verstand is naïef maar eerlijk (verwondert zich, verzint geen feiten); hoog Verstand geeft volledige, onderbouwde antwoorden in de eigen stijl. Groeit traag via Reflecties en daalt nooit. Instelbaar in het dashboard. Zie [ADR-0021](docs/adr/0021-verstand-tempert-de-gedragsregels.md).
_Avoid_: intelligentie, IQ, slimheid, zevende as

**Drijfveer**:
Iets wat een Dynimo wil of niet wil, van één van vier soorten: Wens, Doel (kan bereikt of opgegeven worden), Toekomstdroom of Ergernis (zonder waarde of sterkte). Kleurt welke Emotie een uiting oproept.
_Avoid_: voorkeur, interesse; een Toekomstdroom is geen Droom (de nachtelijke droomtekst)

**Standpunt**:
Een eigen mening die een Dynimo in één beurt laat blijken (tegenspraak, voorkeur of "dit vind ik saai") omdat een Drijfveer duidelijk raakt aan de uiting van de Gesprekspartner. Een pure kiezer (`decideOpinion`) beslist: match boven een drempel (woord-overlap tussen Drijfveertekst en uiting), kans geschaald door Persoonlijkheid (zakelijk, stellig en expressief geeft er meer), en een cooldown van vier beurten zodat er nooit eindeloos wordt tegengesproken. Een Ergernis geeft tegenspraak of "saai" en verhoogt Boos via de gewone delta's; een Wens, Doel of Toekomstdroom geeft een enthousiaste voorkeur. Type2 krijgt er een korte systeemregel bij.
_Avoid_: mening (in code), dwarsigheid

**Reflectie**:
Een Type2-verwerking van recente ervaringen die het geëvolueerde karakter, de persoonlijkheidsassen en de Drijfveren van een Dynimo bijstelt, telkens met een grens op hoeveel er mag verschuiven. Draait wanneer de Dynimo gaat slapen, en bij lange stilte terwijl hij wakker is; dat laatste is zichtbaar aan het gezichtje (reflecterend), maar zegt de Gesprekspartner iets, dan antwoordt de Dynimo gewoon en loopt de Reflectie op de achtergrond verder.
_Avoid_: samenvatting, evaluatie; niet te verwarren met de Afscheidsreflectie

**Droom** (fase 2b):
Een korte, associatieve tekst die Type2 genereert als onderdeel van de Reflectie-bij-het-slapen, op basis van recente Herinneringen, Drijfveren en Persoonlijkheid. Bewaard in een eigen tabel, zeldzaam aangehaald in gesprek. Kan ook spontaan verteld worden: bij een initiatief-moment kiest een pure kiezer (`pickDreamToTell`) een recente (< 7 dagen), nog niet verteld Droom (`told_at`), vaker bij verveeld/kalm/vredig en minder bij boos/druk, nooit tijdens luisteren of spreken; een Spontane herinnering gaat voor (nooit beide in één moment) en Type2 vertelt hem kort en associatief ('Ik droomde…'). Overschrijft de Ontwaakstemming enkel als hij intenser is dan wat de Reflectie anders zou klaarzetten.
_Avoid_: niet te verwarren met een Toekomstdroom (een Drijfveer, geen nachtelijke tekst)

### Expressie

**Emotie**:
Een vaste, eindige categorie uit de set {blij, boos, verrast, kalm, verveeld, nieuwsgierig, bang, droevig, vredig, druk}. 'Neutraal' is geen Emotie: de ruststand toont de Basisemotie (ontbreekt die, dan kalm). Drie **paren** zijn tegenpolen: boos↔vredig, blij↔droevig en druk↔kalm (`EMOTION_PAIRS`); de overige Emoties hebben geen tegenpool. Elke Emotie heeft in de Stemming altijd een waarde van 0 tot 100. Type1 levert per uiting per Emotie een delta (positief of negatief) die de waarde verschuift; vanaf fase 2 is dat hoe de Dynimo zich bij de uiting voelt (met zijn Drijfveren en persoonlijkheid als context), niet de emotie van de Gesprekspartner. Een delta verschuift enkel de Stemming; ze wordt zelf niet getoond.
_Avoid_: sentiment

**Stemming**:
De emotionele toestand van een Dynimo die over beurten heen blijft hangen: een vector met voor elke Emotie een waarde 0–100, plus een tijdstip. De Type1-delta's van een uiting worden (geschaald met `DELTA_SCALE` 0.5, ADR-0017) opgeteld en geclampt op 0–100; tussendoor dooft elke waarde exponentieel uit naar haar ruststand (50, halveringstijd 3 minuten). De zichtbare, dominante Emotie is de hoogste waarde (bij gelijkstand de Basisemotie, anders de eerste in de set); het gezichtje en de toon van Type2 volgen die. `strength(waarde)` (0–1, hoeveel boven de rust) is de enige sterktemaat, ook voor `Mood.intensity`. Van een paar tegenpolen remt de ene kant de andere af: een positieve delta trekt de tegenpool met de helft van die delta omlaag (blij +30 → droevig −15), en de kleinste van een paar is nooit hoger dan 100 min de grootste, dus twee hoge waarden van een paar bestaan nooit tegelijk (ook niet na het uitdoven). Alleen voor weergave (gezichtje, dashboardbalk) golft de getoonde Stemming traag rond de echte waarden (`displayMood`, ADR-0017); die drift wordt nooit opgeslagen en stuurt geen gedrag. Zie [ADR-0012](docs/adr/0012-stemming-als-vector.md), [ADR-0015](docs/adr/0015-emoties-in-tegengestelde-paren.md) en [ADR-0017](docs/adr/0017-stemming-rust-op-50.md).
_Avoid_: humeur, emotie (voor de blijvende toestand)

**Gedrag**:
Hoe een Dynimo een beurt van de Gesprekspartner beantwoordt, per beurt gekozen uit normaal, kort, lang of negeren door een pure beslisfunctie (`decideBehavior`) op basis van de Stemming, de Persoonlijkheidsassen en een rng. Drempels zijn sterktes boven de ruststand (`strength`, ADR-0017; 0,7 = waarde 85, 0,6 = waarde 80). Zeer boos (dominant, sterkte ≥0,7) geeft kans op negeren of kortaf (geschaald door reactiviteit, gedempt door F op T↔F); zeer blij (≥0,7) geeft kans op lange antwoorden en vaker eigen initiatief, sterk nieuwsgierig (≥0,6) ook op vaker eigen initiatief; bang, verveeld of droevig (≥0,6) geeft kans op kort. Een robot (reactiviteit 0) is altijd normaal. Negeren gebeurt nooit twee beurten achter elkaar en nooit bij een initiatief-uiting; het gezichtje toont dan alleen de (boze) Stemming plus een geluid, er komt geen antwoord. De Herinnering wordt wel opgeslagen.
_Avoid_: reactie (te vaag), weigeren

**Spraakgeluid**:
Een kort geschreven geluid ('ha ha', 'pff…', 'hmm…', 'oh!', 'eh…') dat vóór de tekst van een beurt komt zodat TTS het uitspreekt (geen audio tags; werkt met ElevenLabs Flash en Deepgram). Hooguit één per beurt, gekozen door een pure functie (`pickSpeechSound`) uit de dominante Emotie (blij → lach, bang/nieuwsgierig → hmm, verveeld/droevig → zucht, verrast → oh; bij hoge P een aarzeling 'eh…' als de Emotie geen eigen geluid heeft). Kans = basiskans × expressiviteit × waarde van de dominante Emotie; expressiviteit 0, korte antwoorden (<20 tekens), gedrag kort/negeren en herhaling van het vorige geluid geven geen geluid. Werkgeheugen en Herinneringen bewaren de schone tekst zonder geluid. Daarna zet `applyPauses` (`speech-pacing.ts`) per zin een pauzeteken ' … ' in de TTS-tekst, en een tempofactor op `speed`, afhankelijk van de dominante Emotie (zie [ADR-0014](docs/adr/0014-elevenlabs-als-tts.md)); ook dat blijft buiten het geheugen.

**Basisemotie**:
De Emotie die in de ruststand van de Stemming op 65 staat, terwijl alle andere Emoties op 50 rusten (haar tegenpool, als ze er een heeft, op 35); de Stemming dooft er dus naartoe uit. Bij genesis voorgezet door het gekozen Archetype (dat Type2 uit de Seed afleidt) als deel van het temperament, en daarna vrijwel onveranderlijk.
_Avoid_: default-emotie, rustemotie

**Emotiekeyframe**:
De visuele definitie van één emotie: oogvorm/scale/pupil-offset, mondkromming (bezier), achtergrondkleur en, voor een subset van emoties (verrast, boos, bang, droevig), een wenkbrauwstand — de overige emoties gebruiken een neutraal-rechte wenkbrauw. Bij een emotiewissel wordt hiertussen getweend.
_Avoid_: expressie-state, animatie (te generiek)

**Weergavetoestand** (fase 2b):
De niet-emotionele modus van het gezichtje, los van de Emotiekeyframes: *slapend*, *wakker*, *luisterend* (de Gesprekspartner praat), *spreekt* (de Dynimo praat) of *reflecterend*. Bepaalt welke animatielaag toont, niet welke emotie. *Luisterend*/*spreekt* volgen LiveKit's ingebouwde `AgentState`/`UserState`; *reflecterend*/*slapend* zijn eigen logica. Zie [ADR-0011](docs/adr/0011-weergavetoestand-gemengde-bron.md).
_Avoid_: mode, view-state, display-state (in proza toegestaan, niet als term)

**Idle-animatie** (fase 2b):
De continue microbeweging (knipperen, ademhaling, pupilverschuiving, subtiele wenkbrauwbeweging) die in elke Weergavetoestand blijft doorlopen, los van een Emotiekeyframe-wissel — zodat het gezicht nooit stilstaat. Tijdens *spreekt* stuurt de audio van de Dynimo bovendien de mondbeweging.
_Avoid_: ademhaling (dat is er één onderdeel van), micro-animatie

### Perceptie (fase 3)

**Waarneming**:
Een goedkoop, continu Type1-event uit de camera: *aanwezig*, *afwezig* of *nieuw object* (een objectklasse die sinds het wakker worden nog niet stabiel in beeld was). Ontstaat in de face-app (MediaPipe) en gaat over het datachannel naar de agent. Wordt nooit bewaard.
_Avoid_: detectie, event (in proza toegestaan, niet als term)

**Kijken**:
Eén Type2-call met één camerabeeld erbij. Duur, dus alleen wanneer Type1 zegt dat er gekeken moet worden (op vraag of via de initiatiefcheck) of via de `kijk`-tool als vangnet. Het beeld zit enkel in die ene beurt; wat blijft is het tekstantwoord, en daarmee een gewone Herinnering.
_Avoid_: vision (in proza toegestaan), zien, snapshot
