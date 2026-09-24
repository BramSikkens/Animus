import type { SpeechProvider } from "@animus/brain/voice";
import type { VoiceSettings } from "@animus/brain/voice-emotion";

/** Zet de stem op de gedeelde TTS; elke provider noemt de optie anders. */
export function applyTtsVoice(provider: SpeechProvider, tts: { updateOptions(opts: never): void }, voice: string): void {
  const update = tts.updateOptions as (opts: object) => void;
  if (provider === "elevenlabs") update.call(tts, { voiceId: voice, model: "eleven_flash_v2_5", language: "nl" });
  else if (provider === "deepgram") update.call(tts, { model: voice });
  else update.call(tts, { voice });
}

const lastApplied = new WeakMap<object, string>();
const round05 = (n: number) => Math.round(n * 20) / 20;

/**
 * Emotie per uiting (#63): enkel ElevenLabs kent voiceSettings; bij Deepgram/OpenAI niets doen. De plugin herstart
 * de websocket bij elke updateOptions, dus afronden (0.05) en enkel bij een echt andere waarde bijwerken.
 */
export function applyTtsEmotion(provider: SpeechProvider, tts: { updateOptions(opts: never): void }, settings: VoiceSettings): void {
  if (provider !== "elevenlabs") return;
  const rounded = { ...settings, stability: round05(settings.stability), style: round05(settings.style), speed: round05(settings.speed) };
  const key = JSON.stringify(rounded);
  if (lastApplied.get(tts) === key) return;
  lastApplied.set(tts, key);
  (tts.updateOptions as (opts: object) => void).call(tts, { voiceSettings: rounded });
}
