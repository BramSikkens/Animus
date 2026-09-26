import { describe, expect, it } from "vitest";
import { vertrouwdheidFor } from "./vertrouwdheid.js";

const owner = { id: 1, name: "eigenaar", owner: true };
const anna = { id: 2, name: "Anna", owner: false };

describe("vertrouwdheidFor", () => {
  it("geeft onbekend zonder naam of balkje bij Gesprekspartner onbekend (onbekend gezicht/stem)", async () => {
    const deps = { familiarityOf: async () => 0.5, personName: async () => anna.name };
    expect(await vertrouwdheidFor(deps, 7, { soort: "onbekend" })).toEqual({ onbekend: true });
  });

  it("geeft naam en Vertrouwdheidswaarde van de bekende Gesprekspartner (één lichte naam-query, #111)", async () => {
    const deps = {
      familiarityOf: async (_dynimoId: number, personId?: number) => (personId === anna.id ? 0.6 : 0.2),
      personName: async (personId?: number) => (personId === anna.id ? anna.name : null),
    };
    expect(await vertrouwdheidFor(deps, 7, { soort: "persoon", personId: anna.id })).toEqual({ naam: "Anna", waarde: 0.6 });
  });

  it("valt zonder signaal (geen-signaal) terug op de eigenaar, net als hear()", async () => {
    const deps = {
      familiarityOf: async (_dynimoId: number, personId?: number) => (personId === undefined ? 0.4 : 0.9),
      personName: async (personId?: number) => (personId === undefined ? owner.name : null),
    };
    expect(await vertrouwdheidFor(deps, 7, { soort: "geen-signaal" })).toEqual({ naam: "eigenaar", waarde: 0.4 });
  });

  it("geeft onbekend als de eigenaar (nog) geen rij heeft, zonder die aan te maken", async () => {
    const deps = { familiarityOf: async () => 0.2, personName: async () => null };
    expect(await vertrouwdheidFor(deps, 7, { soort: "geen-signaal" })).toEqual({ onbekend: true });
  });
});
