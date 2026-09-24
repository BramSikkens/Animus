import type { SpeechProvider } from "@animus/brain/voice";

/** Zet de stem op de gedeelde TTS; elke provider noemt de optie anders. Emotie per uiting (voiceSettings) volgt in #63. */
export function applyTtsVoice(provider: SpeechProvider, tts: { updateOptions(opts: never): void }, voice: string): void {
  const update = tts.updateOptions as (opts: object) => void;
  if (provider === "elevenlabs") update.call(tts, { voiceId: voice, model: "eleven_flash_v2_5", language: "nl" });
  else if (provider === "deepgram") update.call(tts, { model: voice });
  else update.call(tts, { voice });
}
