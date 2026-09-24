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

// ElevenLabs-voice-ids: alleen [A-Za-z0-9_-], max 64 tekens (komt in een URL/API-call terecht).
const ELEVEN_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ElevenLabs-stemmen komen uit de (open) catalogus: elke geldig gevormde id is toegestaan. Andere providers: de vaste lijst.
function isKnownVoice(provider: SpeechProvider, voice: string): boolean {
  return provider === "elevenlabs" ? ELEVEN_ID.test(voice) : voicesFor(provider).includes(voice);
}

/** De stem om te spreken: de opgeslagen stem, of de default van de provider bij null/onbekend. */
export function resolveVoice(provider: SpeechProvider, stored: string | null, fallback?: string): string {
  const voices = voicesFor(provider);
  if (stored !== null && isKnownVoice(provider, stored)) return stored;
  return fallback || voices[0]!;
}

/** Valideert een formulierwaarde: leeg = default (null), anders moet de stem in de lijst staan; null = ongeldig. */
export function parseVoice(provider: SpeechProvider, raw: unknown): { voice: string | null } | null {
  if (raw === "") return { voice: null };
  return typeof raw === "string" && isKnownVoice(provider, raw) ? { voice: raw } : null;
}

/** TTS-provider: ELEVENLABS_API_KEY, anders DEEPGRAM_API_KEY, anders OpenAI. */
export function speechProvider(env: Record<string, string | undefined>): SpeechProvider {
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  return env.DEEPGRAM_API_KEY ? "deepgram" : "openai";
}

/** Server-side lengtegrenzen voor stemontwerp/-cloning; geeft een foutmelding of null. */
export function voiceInputError(input: { name?: string; description?: string; generatedVoiceId?: string }): string | null {
  if (input.name !== undefined && input.name.length > 100) return "De naam is te lang (max 100 tekens).";
  if (input.description !== undefined && input.description.length > 500) return "De beschrijving is te lang (max 500 tekens).";
  if (input.generatedVoiceId !== undefined && (input.generatedVoiceId === "" || input.generatedVoiceId.length > 128)) return "Ongeldige stem-id.";
  return null;
}
