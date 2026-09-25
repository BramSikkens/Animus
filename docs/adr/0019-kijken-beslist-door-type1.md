# Kijken wordt beslist door Type1, met een tool als vangnet

Een beeld meesturen kost ~800 tokens per beurt. Standaard bij elke Type2-call een frame meesturen is te duur; puur een Type2-tool laat het model telkens een extra stap zetten.

**Besluit.** `classify()` krijgt een apart veld `kijken: boolean`, los van Intent (een vraag kan tegelijk *complex* en kijken zijn), in dezelfde Jev-call en dus zonder extra latency. Is het `true`, dan gaat het meest recente frame (max. 768 px lange zijde, JPEG) mee met de Type2-call; de bestaande licht/zwaar-routering blijft. Mist Type1 het, dan heeft Type2 een `kijk`-tool als vangnet — enkel aangeboden als er in die beurt nog geen frame is meegegeven. Is er geen videotrack, dan krijgt Type2 de regel "je kunt nu niets zien".

**Spontaan kijken** (een nieuw object in beeld) loopt via dezelfde weg: de Waarneming roept meteen de initiatiefcheck aan, met een cooldown (standaard 3 minuten, instelbaar via env).

**Geen beelden bewaren.** Het frame zit enkel in de beurt waarin gekeken wordt; het Werkgeheugen houdt enkel het tekstantwoord, en een Herinnering blijft tekst.
