# Perceptie draait in de browser, niet in Node

Animus.md stelde dat MediaPipe "in Node draait zonder aparte service". MediaPipe's `tasks-vision` is echter voor de browser gebouwd (WASM + WebGL); in Node vraagt het een eigen frame-decoder en meer CPU.

**Besluit.** De face-app opent de webcam, draait MediaPipe (gezicht- en objectdetectie) en stuurt Waarnemingen als events over het bestaande datachannel naar de agent. Daarnaast publiceert ze een videotrack in de LiveKit-room; de agent neemt daar enkel een frame uit wanneer er gekeken wordt. De camera staat aan zolang de Dynimo wakker is.

**Waarom.** Past op het bestaande patroon (de face-app publiceert de microfoon, events lopen over het datachannel) en is het standaard vision-patroon van LiveKit Agents. In fase 4 draait dezelfde face-app in kiosk-mode op de Pi, dus de keuze werkt daar ongewijzigd.

**Afgewezen.** Detectie in de agent (frames decoderen in Node): meer werk en CPU voor niets. Snapshots op aanvraag zonder videotrack: moet toch een eigen transport krijgen, terwijl de videotrack gratis meekomt.

**Revisit.** Wordt de CV-behoefte zwaarder dan MediaPipe aankan (bv. YOLO), dan komt er een aparte Python-service naast — zie Animus.md.
