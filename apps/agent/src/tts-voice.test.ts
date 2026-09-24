import { describe, expect, it, vi } from "vitest";
import { applyTtsEmotion, applyTtsVoice } from "./tts-voice.js";

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

describe("applyTtsEmotion", () => {
  const settings = { stability: 0.4, style: 0.3, speed: 1.05, similarity_boost: 0.75 };

  it("zet bij ElevenLabs de voiceSettings", () => {
    const tts = { updateOptions: vi.fn() };
    applyTtsEmotion("elevenlabs", tts, settings);
    expect(tts.updateOptions).toHaveBeenCalledWith({ voiceSettings: settings });
  });

  it("roept updateOptions niet opnieuw aan bij (afgerond) gelijke settings", () => {
    const tts = { updateOptions: vi.fn() };
    applyTtsEmotion("elevenlabs", tts, settings);
    applyTtsEmotion("elevenlabs", tts, { ...settings, stability: 0.41, style: 0.29 });
    expect(tts.updateOptions).toHaveBeenCalledTimes(1);
    applyTtsEmotion("elevenlabs", tts, { ...settings, stability: 0.6 });
    expect(tts.updateOptions).toHaveBeenCalledTimes(2);
  });

  it("doet bij Deepgram en OpenAI niets", () => {
    const tts = { updateOptions: vi.fn() };
    applyTtsEmotion("deepgram", tts, settings);
    applyTtsEmotion("openai", tts, settings);
    expect(tts.updateOptions).not.toHaveBeenCalled();
  });
});
