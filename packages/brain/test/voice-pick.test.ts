import { describe, expect, it } from "vitest";
import { pickVoiceForCharacter } from "../src/genesis-voice.js";
import type { CatalogVoice } from "../src/voice-catalog.js";

const v = (id: string, over: Partial<CatalogVoice> = {}): CatalogVoice => ({
  id, name: id, gender: "", age: "", accent: "", description: "", useCase: "", language: "", previewUrl: "", category: "premade", usableOnFree: true, ...over,
});

const catalog = [
  v("kind", { name: "Lotte", age: "young", gender: "female", description: "cheerful child voice" }),
  v("opa", { name: "Gerrit", age: "old", gender: "male", description: "raspy old man, slow", language: "nl" }),
  v("bot", { name: "Unit", description: "robotic synthetic voice", useCase: "characters" }),
];

describe("pickVoiceForCharacter", () => {
  it("kiest op Engelse zoektermen", () => {
    expect(pickVoiceForCharacter({ description: "old man raspy", catalog, tier: "starter" })?.id).toBe("opa");
  });
  it("vertaalt Nederlandse termen naar Engels", () => {
    expect(pickVoiceForCharacter({ description: "oude man, hees, langzaam", catalog, tier: "starter" })?.id).toBe("opa");
    expect(pickVoiceForCharacter({ description: "robotachtig, metaalachtig", catalog, tier: "starter" })?.id).toBe("bot");
  });
  it("geeft null zonder match of lege catalogus", () => {
    expect(pickVoiceForCharacter({ description: "alien", catalog, tier: "starter" })).toBeNull();
    expect(pickVoiceForCharacter({ description: "old man", catalog: [], tier: "starter" })).toBeNull();
  });
  it("slaat niet-kiesbare stemmen over en geeft null op free-tier", () => {
    const locked = [v("opa", { description: "old man", usableOnFree: false })];
    expect(pickVoiceForCharacter({ description: "old man", catalog: locked, tier: "starter" })).toBeNull();
    expect(pickVoiceForCharacter({ description: "old man", catalog: [v("x", { description: "old man" })], tier: "free" })).toBeNull();
  });
  it("geeft de voorkeur aan Nederlands/meertalig bij gelijke score", () => {
    const two = [v("en", { description: "old man", language: "en" }), v("nl", { description: "old man", language: "nl" })];
    expect(pickVoiceForCharacter({ description: "old man", catalog: two, tier: "starter" })?.id).toBe("nl");
  });
  it("is deterministisch bij gelijkspel (laagste id)", () => {
    const two = [v("b", { description: "old man" }), v("a", { description: "old man" })];
    expect(pickVoiceForCharacter({ description: "old man", catalog: two, tier: "starter" })?.id).toBe("a");
  });
});
