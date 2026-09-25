# Emoties komen in tegengestelde paren

ADR-0012 maakte de Stemming een vector waarin elke Emotie los van de andere beweegt. Daardoor konden blij en boos (of blij en verdrietig) tegelijk hoog staan zonder dat de ene de andere afremde. We verfijnen dat: drie Emoties krijgen een tegenpool, en de vector blijft verder zoals in ADR-0012.

**Set en paren.** `EMOTIONS` krijgt `droevig`, `vredig` en `druk`. De paren staan als één constante `EMOTION_PAIRS` in `emotion.ts` (browser-veilig): boos↔vredig, blij↔droevig, druk↔kalm. `vredig` vervangt `kalm` bewust niet: kalm is de rustige tegenpool van druk (weinig beweging), vredig de tegenpool van boos (vrede, geen conflict). verrast, nieuwsgierig, bang, verveeld en neutraal blijven zonder tegenpool (bang↔zelfverzekerd is niet toegevoegd: geen nieuwe emotie zonder behoefte).

**Mechaniek (`mood.ts`, pure functies).**
- In `applyDeltas` trekt een *positieve* delta op de ene kant de tegenpool met 50% van die delta (vóór reactiviteit-schaling; daarna schaalt alles mee) omlaag: blij +30 → droevig −15. Een negatieve delta trekt de tegenpool niet omhoog. Type1 scoort de tegenpool dus niet apart omlaag; de delta-prompt zegt dat.
- Na de update én na het uitdoven (`currentMood`) geldt per paar: de kleinste waarde is nooit hoger dan 100 min de grootste. Twee hoge waarden van een paar kunnen dus niet tegelijk bestaan. Deze regel is idempotent (opgeslagen en gelezen waarden komen overeen) en grijpt alleen in bij extreme combinaties (bv. na handmatig zetten in het dashboard).
- De Basisemotie-ruststand (30) en de exponentiële uitdoving uit ADR-0012 blijven ongewijzigd; reactiviteit-schaling ook.

**Opslag.** `mood_values` (jsonb) leest ontbrekende sleutels als 0, dus bestaande rijen blijven geldig zonder datamigratie. Migratie 0019 verruimt alleen de check-constraints voor `base_emotion`, `wake_mood_emotion` en `dreams.emotion`.

**Expressie.** Elk nieuw Emotiekeyframe voor het gezicht, voice-emotion-profielen (droevig: langzaam, hogere stability; vredig: langzaam, hoge stability; druk: snel, lage stability), geluid (droevig en vredig zuchten, druk maakt geen geluid) en gedrag (geen nieuwe gedragsregels: droevig en druk leiden niet tot negeren). Dashboard-sliders en face-balken tonen elk paar naast elkaar (`EMOTION_GROUPS`).
