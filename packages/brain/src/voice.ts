// Browser-veilig: geen node-imports. Agent en dashboard delen dit.
export type SpeechProvider = "elevenlabs" | "deepgram" | "openai";

// Vaste lijsten (geen live API-call). Eerste = huidige default van de agent.
export const VOICES: Record<SpeechProvider, readonly string[]> = {
  // Premade-stemmen (voice-ids). De uitgebreide catalogus volgt in #64.
  elevenlabs: [
    "21m00Tcm4TlvDq8ikWAM", // Rachel
    "pNInz6obpgDQGcFmaJgB", // Adam
    "EXAVITQu4vr4xnSDxMaL", // Bella
    "ErXwobaYiN019PkySvjV", // Antoni
    "TxGEqnHWrfWFTfGW9XjX", // Josh
    "AZnzlk1XvdvUeBnXmlld", // Domi
  ],
  deepgram: [
    "aura-2-beatrix-nl",
    "aura-2-daphne-nl",
    "aura-2-cornelia-nl",
    "aura-2-hestia-nl",
    "aura-2-rhea-nl",
    "aura-2-leda-nl",
    "aura-2-sander-nl",
    "aura-2-lars-nl",
    "aura-2-roman-nl",
  ],
  openai: ["coral", "alloy", "ash", "ballad", "echo", "fable", "nova", "onyx", "sage", "shimmer"],
};

export function voicesFor(provider: SpeechProvider): readonly string[] {
  return VOICES[provider];
}

/** De stem om te spreken: de opgeslagen stem, of de default van de provider bij null/onbekend. */
export function resolveVoice(provider: SpeechProvider, stored: string | null, fallback?: string): string {
  const voices = voicesFor(provider);
  return stored !== null && voices.includes(stored) ? stored : fallback || voices[0]!;
}

/** Valideert een formulierwaarde: leeg = default (null), anders moet de stem in de lijst staan; null = ongeldig. */
export function parseVoice(provider: SpeechProvider, raw: unknown): { voice: string | null } | null {
  if (raw === "") return { voice: null };
  return typeof raw === "string" && voicesFor(provider).includes(raw) ? { voice: raw } : null;
}

/** TTS-provider: ELEVENLABS_API_KEY, anders DEEPGRAM_API_KEY, anders OpenAI. */
export function speechProvider(env: Record<string, string | undefined>): SpeechProvider {
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  return env.DEEPGRAM_API_KEY ? "deepgram" : "openai";
}
