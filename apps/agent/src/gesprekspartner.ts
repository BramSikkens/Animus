/**
 * Beslisregel voor de Gesprekspartner van een beurt (CONTEXT.md, #92/#93): een zekere stemidentificatie bepaalt wie
 * er praat; anders precies één gezicht in beeld en dat is een bekende Persoon; anders onbekend.
 * `faces`: de Personen van de gezichten die nu in beeld zijn (`null` = onbekend gezicht, van faces.ts `inView()`).
 */
export function decideGesprekspartner({ voice, faces }: { voice: { personId: number; sure: boolean } | null; faces?: (number | null)[] }): number | null {
  if (voice?.sure) return voice.personId;
  if (faces?.length === 1 && faces[0] !== null) return faces[0];
  return null;
}

/**
 * Of de agent een Gesprekspartner-optie aan hear() moet meegeven, of die moet weglaten (dan valt hear() terug op
 * de eigenaar). Enkel weglaten als er geen enkel signaal is — geen stemherkenning actief én geen gezicht in beeld
 * (geen camera, of niemand aanwezig) — dat is het enige geval dat exact het gedrag van vóór stem-/gezichtsherkenning
 * blijft. Zodra er wél een camera is, is de eigenaar zelf (die nog geen gezichts-embeddings heeft) daarmee géén
 * uitzondering: hij begint ook als onbekend gezicht, de Dynimo vraagt dan zijn naam, en die nieuwe Persoon moet
 * nadien via het dashboard (#95, samenvoegen) weer met "eigenaar" samengevoegd worden.
 */
export function shouldOverrideGesprekspartner({ hasSpeaker, faces }: { hasSpeaker: boolean; faces: (number | null)[] }): boolean {
  return hasSpeaker || faces.length > 0;
}
