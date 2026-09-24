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

describe("elevenlabs", () => {
  it("kent een startlijst met Rachel als default", () => {
    expect(voicesFor("elevenlabs")[0]).toBe("21m00Tcm4TlvDq8ikWAM");
    expect(resolveVoice("elevenlabs", null)).toBe("21m00Tcm4TlvDq8ikWAM");
  });

  it("gebruikt een meegegeven default (env ELEVENLABS_DEFAULT_VOICE_ID) bij null", () => {
    expect(resolveVoice("elevenlabs", null, "abc123")).toBe("abc123");
    expect(resolveVoice("elevenlabs", "pNInz6obpgDQGcFmaJgB", "abc123")).toBe("pNInz6obpgDQGcFmaJgB");
  });
});

describe("elevenlabs catalogus-stemmen", () => {
  it("accepteert elke niet-lege voice-id (catalogus) bij parseVoice en resolveVoice", () => {
    expect(parseVoice("elevenlabs", "catalogus-id-123")).toEqual({ voice: "catalogus-id-123" });
    expect(parseVoice("elevenlabs", "  ")).toBeNull();
    expect(parseVoice("elevenlabs", 5)).toBeNull();
    expect(resolveVoice("elevenlabs", "catalogus-id-123", "abc123")).toBe("catalogus-id-123");
  });
});

describe("speechProvider", () => {
  it("kiest ElevenLabs met ELEVENLABS_API_KEY, v\u00f3\u00f3r Deepgram", () => {
    expect(speechProvider({ ELEVENLABS_API_KEY: "x", DEEPGRAM_API_KEY: "y" })).toBe("elevenlabs");
    expect(speechProvider({ ELEVENLABS_API_KEY: "" })).toBe("openai");
  });

  it("kiest Deepgram met een DEEPGRAM_API_KEY, anders OpenAI", () => {
    expect(speechProvider({ DEEPGRAM_API_KEY: "x" })).toBe("deepgram");
    expect(speechProvider({})).toBe("openai");
    expect(speechProvider({ DEEPGRAM_API_KEY: "" })).toBe("openai");
  });
});
