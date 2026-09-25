import { describe, expect, it } from "vitest";
import { AXES } from "../src/personality.js";
import { EMOTIONS } from "../src/emotion.js";
import { ARCHETYPES, archetypeOfferText, getArchetype, parseArchetypeId, pickOffer } from "../src/archetypes.js";

describe("ARCHETYPES", () => {
  it("bevat minstens de tien gevraagde archetypes", () => {
    const ids = ARCHETYPES.map((a) => a.id);
    for (const id of ["schattig-wezentje", "robot", "lieve-oude-dame", "leider", "professor", "oude-man", "klein-kind", "wijze-vrouw", "avonturier", "dromer"]) {
      expect(ids).toContain(id);
    }
  });

  it("heeft per archetype alle velden, zes assen in 0..1 en een geldige basisemotie", () => {
    expect(new Set(ARCHETYPES.map((a) => a.id)).size).toBe(ARCHETYPES.length);
    for (const a of ARCHETYPES) {
      expect(a.name && a.description && a.speechStyle && a.voiceHint).toBeTruthy();
      expect(EMOTIONS).toContain(a.baseEmotion);
      for (const axis of AXES) {
        expect(a.axes[axis]).toBeGreaterThanOrEqual(0);
        expect(a.axes[axis]).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("Basisemotie van archetypes", () => {
  it("de lieve oude dame rust op vredig", () => {
    expect(getArchetype("lieve-oude-dame")?.baseEmotion).toBe("vredig");
  });
});

describe("getArchetype / parseArchetypeId", () => {
  it("zoekt op id; onbekend of null geeft null", () => {
    expect(getArchetype("robot")?.name).toBeTruthy();
    expect(getArchetype("bestaat-niet")).toBeNull();
    expect(getArchetype(null)).toBeNull();
  });

  it("parseArchetypeId accepteert enkel bekende ids", () => {
    expect(parseArchetypeId("professor")).toBe("professor");
    expect(parseArchetypeId("")).toBeNull();
    expect(parseArchetypeId("x")).toBeNull();
    expect(parseArchetypeId(5)).toBeNull();
  });
});

describe("pickOffer / archetypeOfferText", () => {
  it("biedt het gevraagde aantal verschillende archetypes aan", () => {
    const offer = pickOffer(Math.random, 4);
    expect(offer).toHaveLength(4);
    expect(new Set(offer.map((a) => a.id)).size).toBe(4);
  });

  it("laat over veel runs alle archetypes voorbijkomen", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const a of pickOffer(Math.random, 4)) seen.add(a.id);
    expect(seen.size).toBe(ARCHETYPES.length);
  });

  it("de aanbodtekst bevat id, naam en beschrijving van elk aangeboden archetype", () => {
    const text = archetypeOfferText(ARCHETYPES);
    for (const a of ARCHETYPES) {
      expect(text).toContain(a.id);
      expect(text).toContain(a.name);
      expect(text).toContain(a.description);
    }
  });
});
