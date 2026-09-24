import { describe, expect, it } from "vitest";
import { AXES, axisGuidelines, mbtiType, parseAxes, type Axes } from "../src/personality.js";

const MIDDLE: Axes = { ie: 0.5, sn: 0.5, tf: 0.5, jp: 0.5, reactivity: 0.5, expressiveness: 0.5 };

describe("mbtiType", () => {
  it("geeft de eerste letter onder 0.5 en de tweede letter vanaf 0.5", () => {
    expect(mbtiType({ ...MIDDLE, ie: 0.1, sn: 0.1, tf: 0.1, jp: 0.1 })).toBe("ISTJ");
    expect(mbtiType({ ...MIDDLE, ie: 0.9, sn: 0.9, tf: 0.9, jp: 0.9 })).toBe("ENFP");
    expect(mbtiType({ ...MIDDLE, ie: 0.2, sn: 0.8, tf: 0.7, jp: 0.3 })).toBe("INFJ");
  });

  it("geeft bij precies 0.5 de tweede letter", () => {
    expect(mbtiType(MIDDLE)).toBe("ENFP");
    expect(mbtiType({ ...MIDDLE, ie: 0.4999 })).toBe("INFP");
  });
});

describe("reactiviteit en expressiviteit", () => {
  it("staan bij de assen maar tellen niet mee in het MBTI-type", () => {
    expect(AXES).toContain("reactivity");
    expect(AXES).toContain("expressiveness");
    expect(mbtiType({ ...MIDDLE, reactivity: 0, expressiveness: 1 })).toBe("ENFP");
  });

  it("geven concrete richtlijnen per uiteinde", () => {
    expect(axisGuidelines({ ...MIDDLE, reactivity: 0.1 })[0]).toContain("nauwelijks");
    expect(axisGuidelines({ ...MIDDLE, reactivity: 0.9 })[0]).toContain("heftig");
    expect(axisGuidelines({ ...MIDDLE, expressiveness: 0.1 })[0]).toContain("verberg");
    expect(axisGuidelines({ ...MIDDLE, expressiveness: 0.9 })[0]).toContain("hardop");
  });
});

describe("axisGuidelines", () => {
  it("geeft geen richtlijnen rond het midden", () => {
    expect(axisGuidelines(MIDDLE)).toEqual([]);
    expect(axisGuidelines({ ...MIDDLE, ie: 0.4, sn: 0.6, tf: 0.45, jp: 0.55 })).toEqual([]);
  });

  it("geeft maximaal één richtlijn per as", () => {
    expect(axisGuidelines({ ie: 0, sn: 0, tf: 0, jp: 0, reactivity: 0, expressiveness: 0 })).toHaveLength(AXES.length);
    expect(axisGuidelines({ ...MIDDLE, ie: 0, tf: 1 })).toHaveLength(2);
  });

  it("geeft uitersten een harde, meetbare instructie", () => {
    expect(axisGuidelines({ ...MIDDLE, ie: 0.1 })[0]).toContain("maximaal één korte zin");
    expect(axisGuidelines({ ...MIDDLE, ie: 0.9 })[0]).toContain("minstens drie zinnen");
  });

  it("laat een introvert kort antwoorden en niet uitweiden", () => {
    const [line] = axisGuidelines({ ...MIDDLE, ie: 0.1 });
    expect(line).toContain("één korte zin");
    expect(line).not.toContain("uitweiden");
  });

  it("laat een extravert uitweiden en terugvragen", () => {
    const [line] = axisGuidelines({ ...MIDDLE, ie: 0.9 });
    expect(line).toContain("uitweiden");
    expect(line).toContain("terugvragen");
    expect(line).not.toContain("één korte zin");
  });

  it("onderscheidt sterk van gematigd", () => {
    const strong = axisGuidelines({ ...MIDDLE, ie: 0.1 })[0];
    const moderate = axisGuidelines({ ...MIDDLE, ie: 0.3 })[0];
    expect(moderate).toBeDefined();
    expect(moderate).not.toBe(strong);
    expect(strong).toContain("sterk");
    expect(moderate).toContain("eerder");
  });

  it("geeft per as de kant-specifieke richtlijn", () => {
    expect(axisGuidelines({ ...MIDDLE, sn: 0.1 })[0]).toContain("concreet");
    expect(axisGuidelines({ ...MIDDLE, sn: 0.9 })[0]).toContain("associatief");
    expect(axisGuidelines({ ...MIDDLE, tf: 0.1 })[0]).toContain("zakelijk");
    expect(axisGuidelines({ ...MIDDLE, tf: 0.9 })[0]).toContain("warm");
    expect(axisGuidelines({ ...MIDDLE, jp: 0.1 })[0]).toContain("gestructureerd");
    expect(axisGuidelines({ ...MIDDLE, jp: 0.9 })[0]).toContain("speels");
  });
});

describe("drempels van axisGuidelines", () => {
  const line = (ie: number) => axisGuidelines({ ...MIDDLE, ie })[0];

  it("kent sterk onder 0.25, gematigd vanaf 0.25, en niets vanaf 0.4", () => {
    expect(line(0.2499)).toContain("sterk");
    expect(line(0.25)).toContain("eerder");
    expect(line(0.3999)).toContain("eerder");
    expect(line(0.4)).toBeUndefined();
  });

  it("kent niets tot en met 0.6, gematigd erboven, en sterk boven 0.75", () => {
    expect(line(0.5)).toBeUndefined();
    expect(line(0.6)).toBeUndefined();
    expect(line(0.6001)).toContain("eerder");
    expect(line(0.75)).toContain("eerder");
    expect(line(0.7501)).toContain("sterk");
  });

  it("kent de uiterste waarden 0 en 1 een sterke richtlijn toe", () => {
    expect(line(0)).toContain("sterk");
    expect(line(1)).toContain("sterk");
  });
});

describe("parseAxes", () => {
  const field = (over: Record<string, unknown>) => (name: string) => over[name] ?? null;

  it("leest elke as uit veld `axis_<as>` als getal en clampt op 0–1", () => {
    expect(
      parseAxes(field({ axis_ie: "0.25", axis_sn: "1.5", axis_tf: "-1", axis_jp: "0.5", axis_reactivity: "0.9", axis_expressiveness: "2" })),
    ).toEqual({ ie: 0.25, sn: 1, tf: 0, jp: 0.5, reactivity: 0.9, expressiveness: 1 });
  });

  it("geeft null bij een ontbrekende of niet-numerieke waarde", () => {
    expect(parseAxes(field({ axis_ie: "0.2", axis_sn: "0.2", axis_tf: "0.2" }))).toBeNull();
    expect(parseAxes(field({ axis_ie: "0.2", axis_sn: "x", axis_tf: "0.2", axis_jp: "0.2", axis_reactivity: "0.2", axis_expressiveness: "0.2" }))).toBeNull();
    expect(parseAxes(field({ axis_ie: "0.2", axis_sn: "0.2", axis_tf: "0.2", axis_jp: "0.2", axis_reactivity: "0.2" }))).toBeNull();
  });
});
