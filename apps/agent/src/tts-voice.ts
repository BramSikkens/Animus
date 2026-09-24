import type { SpeechProvider } from "@animus/brain/voice";
import type { VoiceSettings } from "@animus/brain/voice-emotion";

/** Zet de stem op de gedeelde TTS; elke provider noemt de optie anders. */
export function applyTtsVoice(provider: SpeechProvider, tts: { updateOptions(opts: never): void }, voice: string): void {
  const update = tts.updateOptions as (opts: object) => void;
  if (provider === "elevenlabs") update.call(tts, { voiceId: voice, model: "eleven_flash_v2_5", language: "nl" });
  else if (provider === "deepgram") update.call(tts, { model: voice });
  else update.call(tts, { voice });
}

/** Emotie per uiting (#63): enkel ElevenLabs kent voiceSettings; bij Deepgram/OpenAI niets doen. */
export function applyTtsEmotion(provider: SpeechProvider, tts: { updateOptions(opts: never): void }, settings: VoiceSettings): void {
  if (provider === "elevenlabs") (tts.updateOptions as (opts: object) => void).call(tts, { voiceSettings: settings });
}
