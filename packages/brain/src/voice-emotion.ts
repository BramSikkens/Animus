// Browser-veilig: geen node-imports. Pure vertaling van Stemming + expressiviteit naar ElevenLabs voiceSettings.
import type { Emotion } from "./emotion.js";
import type { MoodValues } from "./mood.js";

export type VoiceSettings = { stability: number; style: number; speed: number; similarity_boost: number };

const NEUTRAL: VoiceSettings = { stability: 0.5, style: 0, speed: 1, similarity_boost: 0.75 };

/** Verschuiving t.o.v. neutraal bij emotiewaarde 100 en expressiviteit 1. */
const PROFILES: Partial<Record<Emotion, { stability: number; style: number; speed: number }>> = {
  blij: { stability: -0.15, style: 0.4, speed: 0.05 },
  boos: { stability: -0.2, style: 0.6, speed: 0.08 },
  bang: { stability: -0.25, style: 0.2, speed: 0.12 },
  verveeld: { stability: 0.3, style: 0, speed: -0.15 },
  kalm: { stability: 0.25, style: 0, speed: -0.08 },
  droevig: { stability: 0.2, style: 0, speed: -0.12 },
  vredig: { stability: 0.3, style: 0, speed: -0.1 },
  druk: { stability: -0.2, style: 0.1, speed: 0.1 },
  verrast: { stability: -0.05, style: 0.3, speed: 0.05 },
  nieuwsgierig: { stability: 0, style: 0.2, speed: 0.03 },
};

export function voiceSettingsFor({ values, expressiveness }: { values: MoodValues; expressiveness: number }): VoiceSettings {
  const out = { ...NEUTRAL };
  for (const [emotion, profile] of Object.entries(PROFILES)) {
    const weight = (values[emotion as Emotion] / 100) * expressiveness;
    out.stability += profile.stability * weight;
    out.style += profile.style * weight;
    out.speed += profile.speed * weight;
  }
  // ElevenLabs-limieten: stability/style 0-1, speed 0.7-1.2.
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return { ...out, stability: clamp(out.stability, 0, 1), style: clamp(out.style, 0, 1), speed: clamp(out.speed, 0.7, 1.2) };
}
