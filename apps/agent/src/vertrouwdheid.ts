import type { Vertrouwdheid } from "@animus/brain/kenmerken";

export type VertrouwdheidDeps = {
  familiarityOf: (dynimoId: number, personId?: number) => Promise<number>;
  listPersons: () => Promise<{ id: number; name: string; owner: boolean }[]>;
};

/**
 * Vertrouwdheid (#105) met de Gesprekspartner van een beurt. `gesprekspartner` zoals hear() dat kent: een bekende
 * Persoon (number), onbekend gezicht/stem (null), of geen signaal (undefined) -> valt terug op de eigenaar, net
 * als hear() zelf.
 */
export async function vertrouwdheidFor(deps: VertrouwdheidDeps, dynimoId: number, gesprekspartner: number | null | undefined): Promise<Vertrouwdheid> {
  if (gesprekspartner === null) return { onbekend: true };
  const waarde = await deps.familiarityOf(dynimoId, gesprekspartner ?? undefined);
  const persons = await deps.listPersons();
  const personId = gesprekspartner ?? persons.find((p) => p.owner)?.id;
  const person = persons.find((p) => p.id === personId);
  return person ? { naam: person.name, waarde } : { onbekend: true };
}
