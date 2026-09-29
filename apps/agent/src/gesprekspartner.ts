import type { Gesprekspartner } from "@animus/core/perception";

/**
 * Beslisregel voor de Gesprekspartner van een beurt (CONTEXT.md, #92/#93/#115): een zekere stemidentificatie bepaalt
 * wie er praat; anders precies één gezicht in beeld en dat is een bekende Persoon; anders, als er perceptie actief
 * is (camera of stemherkenning), onbekend; zonder enige perceptie geen-signaal (hear() valt dan terug op de
 * eigenaar, precies het gedrag van vóór stem-/gezichtsherkenning).
 * `faces`: de Personen van de gezichten die nu in beeld zijn (`null` = onbekend gezicht, van faces.ts `inView()`).
 * `perceptionActive`: stemherkenning actief deze beurt, of ooit een gezicht-Waarneming binnengekomen (faces.seenAny()).
 */
export function decideGesprekspartner({
  voice,
  faces,
  perceptionActive,
}: {
  voice: { personId: number; sure: boolean } | null;
  faces?: (number | null)[];
  perceptionActive: boolean;
}): Gesprekspartner {
  if (voice?.sure) return { soort: "persoon", personId: voice.personId };
  if (faces?.length === 1 && faces[0] !== null) return { soort: "persoon", personId: faces[0] };
  return perceptionActive ? { soort: "onbekend" } : { soort: "geen-signaal" };
}
