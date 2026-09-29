import { describe, expect, it } from "vitest";
import { parseVoice, speechProvider, voiceInputError, resolveVoice, voicesFor } from "../src/voice.js";

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
  it("kent een startlijst van 8 premade-stemmen (werken op de gratis tier) met Sarah als default", () => {
    expect(voicesFor("elevenlabs")).toHaveLength(8);
    expect(voicesFor("elevenlabs")[0]).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(resolveVoice("elevenlabs", null)).toBe("EXAVITQu4vr4xnSDxMaL");
  });

  it("accepteert alleen echte ElevenLabs-ids (20 alfanumerieke tekens); een Deepgram-stem valt terug op de default", () => {
    expect(resolveVoice("elevenlabs", "aura-2-leda-nl")).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(parseVoice("elevenlabs", "aura-2-leda-nl")).toBeNull();
    expect(parseVoice("elevenlabs", "EXAVITQu4vr4xnSDxMaL")).toEqual({ voice: "EXAVITQu4vr4xnSDxMaL" });
    expect(resolveVoice("elevenlabs", "EXAVITQu4vr4xnSDxMaL")).toBe("EXAVITQu4vr4xnSDxMaL");
  });

  it("houdt een eerder opgeslagen stem-id geldig, ook als die niet meer in de startlijst staat", () => {
    expect(resolveVoice("elevenlabs", "21m00Tcm4TlvDq8ikWAM")).toBe("21m00Tcm4TlvDq8ikWAM");
  });

  it("gebruikt een meegegeven default (env ELEVENLABS_DEFAULT_VOICE_ID) bij null", () => {
    expect(resolveVoice("elevenlabs", null, "abc123")).toBe("abc123");
    expect(resolveVoice("elevenlabs", "pNInz6obpgDQGcFmaJgB", "abc123")).toBe("pNInz6obpgDQGcFmaJgB");
  });
});

describe("elevenlabs catalogus-stemmen", () => {
  it("accepteert elke echte voice-id (20 alfanumerieke tekens, catalogus) bij parseVoice en resolveVoice", () => {
    expect(parseVoice("elevenlabs", "abcdefghij0123456789")).toEqual({ voice: "abcdefghij0123456789" });
    expect(parseVoice("elevenlabs", "  ")).toBeNull();
    expect(parseVoice("elevenlabs", 5)).toBeNull();
    expect(resolveVoice("elevenlabs", "abcdefghij0123456789", "abc123")).toBe("abcdefghij0123456789");
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

describe("elevenlabs voice-id validatie", () => {
  it("weigert ids met vreemde tekens of een andere lengte dan 20", () => {
    expect(parseVoice("elevenlabs", "abc/../x")).toBeNull();
    expect(parseVoice("elevenlabs", "a".repeat(19))).toBeNull();
    expect(parseVoice("elevenlabs", "a".repeat(21))).toBeNull();
    expect(parseVoice("elevenlabs", "aaaaaaaaaa_aaaaaaaaa")).toBeNull();
    expect(parseVoice("elevenlabs", "a".repeat(20))).toEqual({ voice: "a".repeat(20) });
  });
});

describe("voiceInputError", () => {
  it("accepteert geldige invoer en weigert te lange of ongeldige velden", () => {
    expect(voiceInputError({ name: "Mijn stem", description: "warm", generatedVoiceId: "abc123" })).toBeNull();
    expect(voiceInputError({ name: "x".repeat(101) })).toMatch(/naam/i);
    expect(voiceInputError({ description: "x".repeat(501) })).toMatch(/beschrijving/i);
    expect(voiceInputError({ generatedVoiceId: "" })).toMatch(/stem/i);
    expect(voiceInputError({ generatedVoiceId: "x".repeat(129) })).toMatch(/stem/i);
  });
});
