import { describe, expect, it } from "vitest";
import type { KenmerkenMessage } from "@animus/brain/kenmerken";
import { kenmerkenPanel } from "./kenmerken-panel.js";

const base: KenmerkenMessage = {
  archetype: "professor",
  basisemotie: "nieuwsgierig",
  assen: { ie: 0.2, sn: 0.8, tf: 0.5, jp: null, reactivity: 0.3, expressiveness: 0.9 },
  verstand: 0.7,
  kernkarakter: "Rustig en nieuwsgierig.",
  vertrouwdheid: { naam: "Bram", waarde: 0.6 },
};

describe("kenmerkenPanel", () => {
  it("combineert de archetype-naam (niet het id) en basisemotie tot één label (#111)", () => {
    expect(kenmerkenPanel(base).label).toBe("Professor · nieuwsgierig");
  });

  it("toont enkel de basisemotie zonder archetype", () => {
    expect(kenmerkenPanel({ ...base, archetype: null }).label).toBe("nieuwsgierig");
  });

  it("valt terug op het ruwe id bij een onbekend archetype", () => {
    expect(kenmerkenPanel({ ...base, archetype: "bestaat-niet" }).label).toBe("bestaat-niet · nieuwsgierig");
  });

  it("geeft elke as met poollabels en waarde, in AXES-volgorde", () => {
    const { assen } = kenmerkenPanel(base);
    expect(assen.map((a) => a.axis)).toEqual(["ie", "sn", "tf", "jp", "reactivity", "expressiveness"]);
    expect(assen.find((a) => a.axis === "ie")).toEqual({ axis: "ie", links: "I", rechts: "E", value: 0.2 });
    expect(assen.find((a) => a.axis === "reactivity")).toEqual({ axis: "reactivity", links: "nuchter", rechts: "reactief", value: 0.3 });
  });

  it("toont een lege as (null) als midden (0.5)", () => {
    expect(kenmerkenPanel(base).assen.find((a) => a.axis === "jp")?.value).toBe(0.5);
  });

  it("geeft Verstand door, en midden (0.5) als het leeg (null) is", () => {
    expect(kenmerkenPanel(base).verstand).toBe(0.7);
    expect(kenmerkenPanel({ ...base, verstand: null }).verstand).toBe(0.5);
  });

  it("geeft kernkarakter ongewijzigd door", () => {
    expect(kenmerkenPanel(base).kernkarakter).toBe("Rustig en nieuwsgierig.");
  });

  it("zet de bekende Vertrouwdheid om in een label mét het woord 'Vertrouwdheid' en een balkwaarde", () => {
    const panel = kenmerkenPanel(base);
    expect(panel.vertrouwdheidLabel).toBe("Vertrouwdheid: Bram");
    expect(panel.vertrouwdheidWaarde).toBe(0.6);
  });

  it("zet een onbekende Vertrouwdheid om in 'Vertrouwdheid: onbekend', zonder balkwaarde", () => {
    const panel = kenmerkenPanel({ ...base, vertrouwdheid: { onbekend: true } });
    expect(panel.vertrouwdheidLabel).toBe("Vertrouwdheid: onbekend");
    expect(panel.vertrouwdheidWaarde).toBeNull();
  });
});
