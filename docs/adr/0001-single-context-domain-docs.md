# Single-context domain docs (voorlopig)

Animus is opgezet als een monorepo-visie met meerdere modules (Brein, Geheugen, Identiteit, Expressie, Perceptie), wat een `CONTEXT-MAP.md` met een `CONTEXT.md` per module zou kunnen rechtvaardigen. Er is echter nog geen code — de modulegrenzen zijn nog niet in pnpm-packages omgezet. We houden daarom voorlopig één root-`CONTEXT.md` aan; vroeg opsplitsen zou vocabulaire over meerdere bestanden verspreiden voordat de grenzen bewezen zijn.

## Consequences

**Revisit-trigger:** herzie deze beslissing zodra de eerste pnpm-package een eigen, divergerende woordenschat krijgt — bijvoorbeeld de CV-microservice in fase 4, of wanneer brein-API en gezichtje-app termen anders gaan gebruiken. Dat is het signaal om naar `CONTEXT-MAP.md` te migreren.
