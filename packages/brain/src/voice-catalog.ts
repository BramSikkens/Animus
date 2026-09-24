// Server-side ElevenLabs-stemcatalogus. Alleen op de server gebruiken: de API-key mag nooit naar de client.
export type CatalogVoice = {
  id: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  description: string;
  useCase: string;
  language: string;
  previewUrl: string;
};

type Raw = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Normaliseert een stem uit /v1/voices (labels) of /v1/shared-voices (platte velden); null zonder id of naam. */
export function normalizeVoice(raw: Raw): CatalogVoice | null {
  const labels = (raw.labels ?? {}) as Raw;
  const verified = Array.isArray(raw.verified_languages) ? (raw.verified_languages as Raw[]) : [];
  const id = str(raw.voice_id);
  const name = str(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    gender: str(raw.gender) || str(labels.gender),
    age: str(raw.age) || str(labels.age),
    accent: str(raw.accent) || str(labels.accent),
    description: str(raw.description) || str(labels.descriptive) || str(raw.descriptive),
    useCase: str(raw.use_case) || str(labels.use_case),
    language: str(raw.language) || str(labels.language) || str(verified[0]?.language),
    previewUrl: str(raw.preview_url),
  };
}

export type VoiceFilter = { gender?: string; age?: string; text?: string; language?: string };

/** Lege filterwaarde = geen filter. Stemmen zonder taal gelden als meertalig en passen bij elke taal. */
export function filterVoices(voices: CatalogVoice[], filter: VoiceFilter): CatalogVoice[] {
  const text = filter.text?.trim().toLowerCase();
  return voices.filter(
    (voice) =>
      (!filter.gender || voice.gender === filter.gender) &&
      (!filter.age || voice.age === filter.age) &&
      (!filter.language || !voice.language || voice.language === filter.language) &&
      (!text || [voice.name, voice.description, voice.accent, voice.useCase].some((field) => field.toLowerCase().includes(text))),
  );
}

const API = "https://api.elevenlabs.io/v1";
const MAX_PAGES = 5; // ponytail: 5 x 100 Voice Library-stemmen per taal is ruim genoeg; verhoog bij behoefte.

async function getJson(fetchFn: typeof fetch, url: string, apiKey: string): Promise<Raw> {
  const response = await fetchFn(url, { headers: { "xi-api-key": apiKey } });
  if (!response.ok) throw new Error(`ElevenLabs-catalogus gaf status ${response.status}`);
  return (await response.json()) as Raw;
}

/** Eigen/premade stemmen (/v1/voices) plus de Voice Library voor `language` (/v1/shared-voices), ontdubbeld op id. */
export async function fetchCatalog(fetchFn: typeof fetch, apiKey: string, language: string): Promise<CatalogVoice[]> {
  const raws = ((await getJson(fetchFn, `${API}/voices`, apiKey)).voices ?? []) as Raw[];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson(fetchFn, `${API}/shared-voices?language=${encodeURIComponent(language)}&page_size=100&page=${page}`, apiKey);
    raws.push(...((body.voices ?? []) as Raw[]));
    if (!body.has_more) break;
  }
  const byId = new Map<string, CatalogVoice>();
  for (const raw of raws) {
    const voice = normalizeVoice(raw);
    if (voice && !byId.has(voice.id)) byId.set(voice.id, voice);
  }
  return [...byId.values()];
}

/** In-memory cache met ttl; mislukte loads worden niet onthouden. */
export function cached<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let entry: { value: T; at: number } | undefined;
  return async () => {
    if (entry && now() - entry.at < ttlMs) return entry.value;
    const value = await load();
    entry = { value, at: now() };
    return value;
  };
}
