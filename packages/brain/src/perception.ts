// Browser-veilig: geen node-imports. De face-app én de agent delen dit contract (ADR-0018, CONTEXT.md: Waarneming).

// Gezichtsherkenning (#93, ADR-0020): pgvector `<->` is de L2-afstand tussen twee embeddings. Human's eigen
// similarity() (src/face/match.ts@3.3.6) rekent similarity = (1 − √(25·Σd²)/100 − 0.2) / 0.6, en Human's
// vuistregel is "similarity > 0.5 is een match". Met Σd² = L2² (dezelfde som die pgvector's `<->` neemt vóór de
// wortel) volgt: similarity > 0.5 ⇔ (0.8 − 0.05·L2)/0.6 > 0.5 ⇔ L2 < 10. Vandaar de default 10.
// Gedeeld tussen de brain (index.ts) en apps/agent/src/faces.ts (#114: was daar gedupliceerd).
export const DEFAULT_FACE_MATCH_DISTANCE = 10;

/**
 * Aanleiding voor de agent om de initiatiefcheck uit te lokken (considerInitiative). "onbekend" (#92/#93) is geen
 * Waarneming (isWaarneming valideert hem niet): hij komt van stem- of gezichtsherkenning in de agent zelf.
 */
export type Aanleiding = { soort: "terug" } | { soort: "nieuw-object"; object: string } | { soort: "onbekend" };

/**
 * Wie er deze beurt met de Dynimo praat (CONTEXT.md: Gesprekspartner), gedeeld tussen de agent (die hem bepaalt uit
 * stem-/gezichtsherkenning, `apps/agent/src/gesprekspartner.ts`) en de brain (`hear()`-optie, #115): "persoon" een
 * bekende Persoon; "onbekend" een niet-herkende stem/gezicht terwijl er wél perceptie actief was (camera of
 * stemherkenning); "geen-signaal" geen enkele perceptie actief — hear() valt dan terug op de eigenaar.
 */
export type Gesprekspartner = { soort: "persoon"; personId: number } | { soort: "onbekend" } | { soort: "geen-signaal" };
