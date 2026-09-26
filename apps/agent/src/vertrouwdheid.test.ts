import { describe, expect, it } from "vitest";
import { vertrouwdheidFor } from "./vertrouwdheid.js";

const owner = { id: 1, name: "eigenaar", owner: true };
const anna = { id: 2, name: "Anna", owner: false };

describe("vertrouwdheidFor", () => {
  it("geeft onbekend zonder naam of balkje bij gesprekspartner null (onbekend gezicht/stem)", async () => {
    const deps = { familiarityOf: async () => 0.5, listPersons: async () => [owner, anna] };
    expect(await vertrouwdheidFor(deps, 7, null)).toEqual({ onbekend: true });
  });

  it("geeft naam en Vertrouwdheidswaarde van de bekende Gesprekspartner", async () => {
    const deps = { familiarityOf: async (_dynimoId: number, personId?: number) => (personId === anna.id ? 0.6 : 0.2), listPersons: async () => [owner, anna] };
    expect(await vertrouwdheidFor(deps, 7, anna.id)).toEqual({ naam: "Anna", waarde: 0.6 });
  });

  it("valt zonder signaal (undefined) terug op de eigenaar, net als hear()", async () => {
    const deps = { familiarityOf: async (_dynimoId: number, personId?: number) => (personId === undefined ? 0.4 : 0.9), listPersons: async () => [owner, anna] };
    expect(await vertrouwdheidFor(deps, 7, undefined)).toEqual({ naam: "eigenaar", waarde: 0.4 });
  });
});
