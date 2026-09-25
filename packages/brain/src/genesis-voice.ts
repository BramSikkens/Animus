// Genesis-stemkeuze: zoektermen (NL + EN) tegen de ElevenLabs-catalogus. Puur en zonder netwerk; catalogus komt van buiten.
import { cached, fetchCatalog, fetchTier, type CatalogVoice } from "./voice-catalog.js";
import { adoptVoice, designVoice, saveDesignedVoice } from "./voice-design.js";

// ElevenLabs-labels zijn Engels: Nederlandse stemtermen krijgen een Engels equivalent erbij.
// ponytail: kleine handmatige lijst; breid uit als archetypes/Type2 vaker termen missen.
const NL_EN: Record<string, string[]> = {
  oude: ["old"], oud: ["old"], oudere: ["old"], man: ["male"], mannelijk: ["male"], mannenstem: ["male"],
  vrouw: ["female", "woman"], dame: ["female", "woman"], vrouwelijk: ["female"],
  kind: ["child", "young"], klein: ["small", "young"], kleine: ["small", "young"], jong: ["young"], jonge: ["young"],
  hees: ["raspy", "hoarse"], langzaam: ["slow"], snel: ["fast"], diep: ["deep"], laag: ["low", "deep"], hoog: ["high"],
  zacht: ["soft"], rustig: ["calm"], kalm: ["calm"], vrolijk: ["cheerful"], energiek: ["energetic"], stoer: ["rugged"],
  robot: ["robotic", "synthetic"], robotachtig: ["robotic", "synthetic"], metaalachtig: ["metallic", "robotic"],
  buitenaards: ["alien"], monotoon: ["monotone"], gezaghebbend: ["authoritative"], beschaafd: ["refined"], dromerig: ["dreamy"],
};
const STOP = new Set(["een", "het", "van", "met", "zijn", "and", "the", "voor", "als", "maar"]);

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));

/** Beste kiesbare stem voor een stembeschrijving, of null. Op tier "free" en zonder treffer null. Gelijkspel: Nederlands/meertalig, dan laagste id. */
export function pickVoiceForCharacter({ description, catalog, tier }: { description: string; catalog: CatalogVoice[]; tier: string }): CatalogVoice | null {
  if (tier === "free") return null;
  const terms = new Set(words(description).flatMap((w) => [w, ...(NL_EN[w] ?? [])]));
  let best: { voice: CatalogVoice; score: number } | null = null;
  for (const voice of catalog) {
    if (!voice.usableOnFree) continue;
    const fields = new Set(words([voice.name, voice.description, voice.gender, voice.age, voice.accent, voice.useCase].join(" ")));
    let score = [...terms].filter((t) => fields.has(t)).length;
    if (score === 0) continue;
    if (!voice.language || voice.language === "nl") score += 0.5;
    if (!best || score > best.score || (score === best.score && voice.id < best.voice.id)) best = { voice, score };
  }
  return best?.voice ?? null;
}

export type GenesisVoiceDeps = {
  loadCatalog: () => Promise<{ catalog: CatalogVoice[]; tier: string }>;
  /** Voegt een Voice Library-stem aan het account toe (anders kent TTS hem niet); geeft het bruikbare voice_id. */
  adopt?: (voice: CatalogVoice) => Promise<string>;
  /** Alleen gezet als voice design aan staat (GENESIS_VOICE_DESIGN=1); geeft het nieuwe voice_id of null. Kost tegoed. */
  design?: (description: string, name: string) => Promise<string | null>;
};

/** Stem voor een net geboren Dynimo, of null (default-stem). Faalt nooit: elke fout wordt gelogd en levert null. */
export async function chooseGenesisVoice(
  deps: GenesisVoiceDeps,
  { description, searchTerms, hint, name }: { description: string; searchTerms: string[]; hint: string; name: string },
): Promise<{ voice: string; description: string } | null> {
  const profileDescription = description.trim() || hint;
  try {
    const { catalog, tier } = await deps.loadCatalog();
    if (tier === "free") return null;
    const match = pickVoiceForCharacter({ description: [description, ...searchTerms, hint].join(" "), catalog, tier });
    if (match) return { voice: deps.adopt ? await deps.adopt(match) : match.id, description: profileDescription };
    if (!deps.design || !profileDescription) return null;
    const designed = await deps.design(profileDescription, name);
    return designed ? { voice: designed, description: profileDescription } : null;
  } catch (error) {
    console.warn("Genesis-stemkeuze faalde; default-stem blijft:", error instanceof Error ? error.message : error);
    return null;
  }
}

const PREVIEW_TEXT =
  "Hallo, ik ben net geboren en ontdek de wereld om me heen. Ik praat graag over alles wat ik zie, hoor en voel, en ik hoop dat we samen veel gaan beleven.";

/** Echte ElevenLabs-koppeling; undefined zonder ELEVENLABS_API_KEY. Voice design (kost tegoed) alleen met GENESIS_VOICE_DESIGN=1. */
export function elevenLabsGenesisVoices(env: Record<string, string | undefined>, baseFetch: typeof fetch = fetch, timeoutMs = 8000): GenesisVoiceDeps | undefined {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) return undefined;
  // Elke aanroep krijgt een timeout: een hangende ElevenLabs mag genesis niet blokkeren (chooseGenesisVoice vangt de fout op).
  const fetchFn = ((input, init) => baseFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })) as typeof fetch;
  const loadCatalog = cached(async () => {
    const tier = await fetchTier(fetchFn, apiKey);
    return { tier, catalog: tier === "free" ? [] : await fetchCatalog(fetchFn, apiKey, "nl", tier) };
  }, 10 * 60_000);
  const design =
    env.GENESIS_VOICE_DESIGN === "1"
      ? async (description: string, name: string) => {
          const [preview] = await designVoice(fetchFn, apiKey, `${description}. Spreekt Nederlands.`, PREVIEW_TEXT);
          return preview ? saveDesignedVoice(fetchFn, apiKey, { name: `Animus ${name}`, description, generatedVoiceId: preview.generatedVoiceId }) : null;
        }
      : undefined;
  return { loadCatalog, design, adopt: (voice) => adoptVoice(fetchFn, apiKey, voice) };
}

/** Standaardkoppeling voor aanroepers (dashboard/agent): expliciet meegeven aan createBrain({ voices }); createBrain zelf leest geen omgeving. */
export const defaultVoiceDeps = (env: Record<string, string | undefined>): GenesisVoiceDeps | undefined => elevenLabsGenesisVoices(env);
