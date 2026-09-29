import { describe, expect, it } from "vitest";
import { TYPE2_MODEL_CATALOG, type2Catalog } from "../src/config.js";

const BASE_ENV = { TYPE2_LIGHT_MODEL: "anthropic:claude-haiku-4-5", TYPE2_HEAVY_MODEL: "anthropic:claude-opus-4-1" };

describe("type2Catalog", () => {
  it("bevat enkel catalogus-modellen van providers met een sleutel", () => {
    const catalog = type2Catalog({ ...BASE_ENV, ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(catalog.available).toEqual(expect.arrayContaining(["anthropic:claude-haiku-4-5", "anthropic:claude-sonnet-4-5", "anthropic:claude-opus-4-1"]));
    expect(catalog.available).not.toContain("openai:gpt-5-mini");
    expect(catalog.available).not.toContain("openai:gpt-5");
  });

  it("vult aan met beide providers als beide sleutels gezet zijn", () => {
    const catalog = type2Catalog({ ...BASE_ENV, ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-oai-test" });
    expect(catalog.available).toEqual(expect.arrayContaining([...TYPE2_MODEL_CATALOG]));
  });

  it("neemt de env-standaarden altijd op, ook zonder sleutel voor die provider", () => {
    // Geen enkele sleutel gezet: de catalogus zelf filtert alles weg, maar de standaarden blijven kiesbaar.
    const catalog = type2Catalog(BASE_ENV);
    expect(catalog.available).toEqual([BASE_ENV.TYPE2_LIGHT_MODEL, BASE_ENV.TYPE2_HEAVY_MODEL]);
  });

  it("geeft de env-standaarden terug als defaults", () => {
    const catalog = type2Catalog({ ...BASE_ENV, ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(catalog.defaults).toEqual({ light: BASE_ENV.TYPE2_LIGHT_MODEL, heavy: BASE_ENV.TYPE2_HEAVY_MODEL });
  });
});
