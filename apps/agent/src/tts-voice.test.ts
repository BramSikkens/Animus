import { describe, expect, it, vi } from "vitest";
import { applyTtsVoice } from "./tts-voice.js";

describe("applyTtsVoice", () => {
  it("zet bij ElevenLabs voiceId, Flash v2.5 en Nederlands", () => {
    const tts = { updateOptions: vi.fn() };
    applyTtsVoice("elevenlabs", tts, "abc");
    expect(tts.updateOptions).toHaveBeenCalledWith({ voiceId: "abc", model: "eleven_flash_v2_5", language: "nl" });
  });

  it("zet bij Deepgram het model", () => {
    const tts = { updateOptions: vi.fn() };
    applyTtsVoice("deepgram", tts, "aura-2-lars-nl");
    expect(tts.updateOptions).toHaveBeenCalledWith({ model: "aura-2-lars-nl" });
  });

  it("zet bij OpenAI de voice", () => {
    const tts = { updateOptions: vi.fn() };
    applyTtsVoice("openai", tts, "nova");
    expect(tts.updateOptions).toHaveBeenCalledWith({ voice: "nova" });
  });
});
