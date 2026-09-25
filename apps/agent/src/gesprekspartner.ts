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
 * de eigenaar — het gedrag van vóór stem-/gezichtsherkenning, #93). Enkel weglaten als er geen enkel signaal is:
 * geen stemherkenning actief én geen gezicht in beeld (geen camera, of niemand aanwezig).
 */
export function shouldOverrideGesprekspartner({ hasSpeaker, faces }: { hasSpeaker: boolean; faces: (number | null)[] }): boolean {
  return hasSpeaker || faces.length > 0;
}
