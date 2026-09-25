/**
 * Beslisregel voor de Gesprekspartner van een beurt (CONTEXT.md, #92): een zekere stemidentificatie bepaalt wie er
 * praat; anders onbekend. #93 breidt dit uit met een gezicht als de stem onzeker is.
 */
export function decideGesprekspartner({ voice }: { voice: { personId: number; sure: boolean } | null }): number | null {
  return voice?.sure ? voice.personId : null;
}
