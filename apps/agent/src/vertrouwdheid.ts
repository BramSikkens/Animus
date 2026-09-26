import type { Vertrouwdheid } from "@animus/brain/kenmerken";
import type { Gesprekspartner } from "@animus/brain/perception";

export type VertrouwdheidDeps = {
  familiarityOf: (dynimoId: number, personId?: number) => Promise<number>;
  /** Eén lichte query: naam van `personId` (default eigenaar), null zonder rij; maakt de eigenaar nooit aan (#111). */
  personName: (personId?: number) => Promise<string | null>;
};

/**
 * Vertrouwdheid (#105) met de Gesprekspartner van een beurt. `gesprekspartner` zoals hear() dat kent (#115): een
 * bekende Persoon, onbekend gezicht/stem, of geen-signaal -> valt terug op de eigenaar, net als hear() zelf.
 */
export async function vertrouwdheidFor(deps: VertrouwdheidDeps, dynimoId: number, gesprekspartner: Gesprekspartner): Promise<Vertrouwdheid> {
  if (gesprekspartner.soort === "onbekend") return { onbekend: true };
  const personId = gesprekspartner.soort === "persoon" ? gesprekspartner.personId : undefined;
  const [waarde, naam] = await Promise.all([deps.familiarityOf(dynimoId, personId), deps.personName(personId)]);
  return naam ? { naam, waarde } : { onbekend: true };
}
