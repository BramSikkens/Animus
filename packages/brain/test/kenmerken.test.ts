import { describe, expect, it } from "vitest";
import { KENMERKEN_TOPIC, isKenmerkenMessage, type KenmerkenMessage } from "../src/kenmerken.js";

const geldig: KenmerkenMessage = {
  archetype: "professor",
  basisemotie: "nieuwsgierig",
  assen: { ie: 0.2, sn: 0.8, tf: 0.5, jp: null, reactivity: 0.5, expressiveness: 0.5 },
  verstand: 0.9,
  kernkarakter: "Rustig en nieuwsgierig.",
  vertrouwdheid: { naam: "Bram", waarde: 0.6 },
};

describe("kenmerken", () => {
  it("heeft een vast topic", () => {
    expect(KENMERKEN_TOPIC).toBe("kenmerken");
  });

  it("valideert een volledig, geldig bericht met isKenmerkenMessage", () => {
    expect(isKenmerkenMessage(geldig)).toBe(true);
    expect(isKenmerkenMessage({ ...geldig, archetype: null, vertrouwdheid: { onbekend: true } })).toBe(true);
  });

  it("verwerpt onverwachte vormen", () => {
    expect(isKenmerkenMessage(null)).toBe(false);
    expect(isKenmerkenMessage({ ...geldig, basisemotie: "dromend" })).toBe(false);
    expect(isKenmerkenMessage({ ...geldig, assen: { ...geldig.assen, sn: "hoog" } })).toBe(false);
    expect(isKenmerkenMessage({ ...geldig, vertrouwdheid: { naam: "Bram" } })).toBe(false);
  });
});
