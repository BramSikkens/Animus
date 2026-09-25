# Personen herkennen aan gezicht én stem

Fase 3 maakt het geheugen per Persoon. Daarvoor moet de Dynimo weten wie er aanwezig is en wie er praat. MediaPipe detecteert gezichten maar herkent niemand; Deepgram onderscheidt sprekers enkel binnen één sessie.

**Besluit.**
- **Gezicht → wie is aanwezig.** `@vladmandic/human` (MIT, actief onderhouden; `face-api.js` is sinds begin 2025 gearchiveerd) draait naast MediaPipe in de face-app (ADR-0018) en levert gezichts-embeddings. Die gaan met de Waarneming *aanwezig* mee (bij verschijnen, daarna om de paar seconden, niet per frame). De brain matcht ze tegen pgvector.
- **Stem → wie praat.** Picovoice Eagle (on-device, taalonafhankelijk, Node-SDK) in de agent, achter een smalle interface (`identify`, `enroll`), zodat sherpa-onnx (Apache-2.0) een vervanger kan zijn als de gratis tier (3 actieve gebruikers) knelt. Stemprofielen staan als bytes in Postgres.
- **Samenvoegen:** de stem beslist wie de Gesprekspartner is; is die onzeker en staat er precies één gezicht in beeld, dan die Persoon; anders *onbekend*.
- **Een Persoon is globaal**, de relatie (Vertrouwdheid, Herinneringen) per Dynimo × Persoon.

**Privacy.** Gezichts- en stem-embeddings zijn biometrische gegevens (art. 9 AVG). Ze blijven lokaal (Postgres), maximaal 5 per soort per Persoon, nooit beelden of audio, en zijn per Persoon wisbaar in het dashboard.

**Afgewezen.** Enkel gezicht: weet bij twee mensen in beeld niet wie praat. Enkel stem: kan niet begroeten bij terugkomst en werkt niet voor wie zwijgt. Een harde muur tussen de Herinneringen van verschillende Personen: maakt de Dynimo dommer in een huishouden dat veel deelt; discretie is een Type2-regel.
