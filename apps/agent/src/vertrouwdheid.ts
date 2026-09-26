import type { Vertrouwdheid } from "@animus/brain/kenmerken";
import type { Gesprekspartner } from "@animus/brain/perception";

export type VertrouwdheidDeps = {
  familiarityOf: (dynimoId: number, personId?: number) => Promise<number>;
  listPersons: () => Promise<{ id: number; name: string; owner: boolean }[]>;
};

/**
 * Vertrouwdheid (#105) met de Gesprekspartner van een beurt. `gesprekspartner` zoals hear() dat kent (#115): een
 * bekende Persoon, onbekend gezicht/stem, of geen-signaal -> valt terug op de eigenaar, net als hear() zelf.
 */
export async function vertrouwdheidFor(deps: VertrouwdheidDeps, dynimoId: number, gesprekspartner: Gesprekspartner): Promise<Vertrouwdheid> {
  if (gesprekspartner.soort === "onbekend") return { onbekend: true };
  const personId = gesprekspartner.soort === "persoon" ? gesprekspartner.personId : undefined;
  const waarde = await deps.familiarityOf(dynimoId, personId);
  const persons = await deps.listPersons();
  const resolvedId = personId ?? persons.find((p) => p.owner)?.id;
  const person = persons.find((p) => p.id === resolvedId);
  return person ? { naam: person.name, waarde } : { onbekend: true };
}
