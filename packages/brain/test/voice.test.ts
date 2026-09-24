import { describe, expect, it } from "vitest";
import { parseVoice, speechProvider, resolveVoice, voicesFor } from "../src/voice.js";

describe("voicesFor", () => {
  it("geeft de stemmen van de gekozen provider, met de huidige default erin", () => {
    expect(voicesFor("deepgram")).toContain("aura-2-beatrix-nl");
    expect(voicesFor("openai")).toContain("coral");
    expect(voicesFor("openai")).not.toContain("aura-2-beatrix-nl");
  });
});

describe("resolveVoice", () => {
  it("gebruikt de opgeslagen stem als die bij de provider hoort", () => {
    expect(resolveVoice("deepgram", "aura-2-lars-nl")).toBe("aura-2-lars-nl");
  });

  it("valt terug op de default bij null of een stem van een andere provider", () => {
    expect(resolveVoice("deepgram", null)).toBe("aura-2-beatrix-nl");
    expect(resolveVoice("openai", null)).toBe("coral");
    expect(resolveVoice("openai", "aura-2-lars-nl")).toBe("coral");
  });
});

describe("parseVoice", () => {
  it("geeft de stem als die in de lijst van de provider zit", () => {
    expect(parseVoice("openai", "nova")).toEqual({ voice: "nova" });
  });

  it("geeft null voor leeg (= default)", () => {
    expect(parseVoice("openai", "")).toEqual({ voice: null });
  });

  it("weigert een stem die niet in de lijst zit of geen tekst is", () => {
    expect(parseVoice("openai", "aura-2-lars-nl")).toBeNull();
    expect(parseVoice("openai", null)).toBeNull();
  });
});

describe("speechProvider", () => {
  it("kiest Deepgram met een DEEPGRAM_API_KEY, anders OpenAI", () => {
    expect(speechProvider({ DEEPGRAM_API_KEY: "x" })).toBe("deepgram");
    expect(speechProvider({})).toBe("openai");
    expect(speechProvider({ DEEPGRAM_API_KEY: "" })).toBe("openai");
  });
});
