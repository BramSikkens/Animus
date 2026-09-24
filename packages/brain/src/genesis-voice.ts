// Genesis-stemkeuze: zoektermen (NL + EN) tegen de ElevenLabs-catalogus. Puur en zonder netwerk; catalogus komt van buiten.
import type { CatalogVoice } from "./voice-catalog.js";

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
