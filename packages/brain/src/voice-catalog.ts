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
  category: string;
  /** Kiesbaar op dit account: op de gratis tier alleen premade/eigen stemmen (niet uit de Voice Library). */
  usableOnFree: boolean;
};

export const FREE_TIER_MESSAGE = "vereist betaald ElevenLabs-abonnement (Starter)";
const FREE_CATEGORIES = ["premade", "generated", "cloned", "professional"];

type Raw = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Normaliseert een stem uit /v1/voices (labels) of /v1/shared-voices (platte velden); null zonder id of naam. */
export function normalizeVoice(raw: Raw, library = false): CatalogVoice | null {
  const labels = (raw.labels ?? {}) as Raw;
  const verified = Array.isArray(raw.verified_languages) ? (raw.verified_languages as Raw[]) : [];
  const id = str(raw.voice_id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const category = str(raw.category);
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
    category,
    usableOnFree: !library && FREE_CATEGORIES.includes(category),
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

/** Abonnement-tier (bv. "free"); lege string als die onbekend is (fout of onverwacht antwoord). De key wordt nooit gelogd. */
export async function fetchTier(fetchFn: typeof fetch, apiKey: string): Promise<string> {
  try {
    const tier = (await getJson(fetchFn, `${API}/user/subscription`, apiKey)).tier;
    return typeof tier === "string" ? tier : "";
  } catch {
    return "";
  }
}

/** Eigen/premade stemmen (/v1/voices) plus de Voice Library voor `language` (/v1/shared-voices), ontdubbeld op id. Op tier "free" zijn bibliotheekstemmen niet kiesbaar. */
export async function fetchCatalog(fetchFn: typeof fetch, apiKey: string, language: string, tier = ""): Promise<CatalogVoice[]> {
  const own = ((await getJson(fetchFn, `${API}/voices`, apiKey)).voices ?? []) as Raw[];
  const library: Raw[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson(fetchFn, `${API}/shared-voices?language=${encodeURIComponent(language)}&page_size=100&page=${page}`, apiKey);
    library.push(...((body.voices ?? []) as Raw[]));
    if (!body.has_more) break;
  }
  const byId = new Map<string, CatalogVoice>();
  for (const [raws, isLibrary] of [[own, false], [library, true]] as const) {
    for (const raw of raws) {
      const voice = normalizeVoice(raw, isLibrary);
      if (voice && !byId.has(voice.id)) byId.set(voice.id, { ...voice, usableOnFree: tier !== "free" || voice.usableOnFree });
    }
  }
  return [...byId.values()];
}

/** Foutmelding als de gekozen stem in de catalogus staat maar op dit account niet kiesbaar is; anders null. */
export function unusableVoiceError(voices: CatalogVoice[], id: string): string | null {
  return voices.find((voice) => voice.id === id)?.usableOnFree === false ? FREE_TIER_MESSAGE : null;
}

/** In-memory cache met ttl; deelt lopende loads en onthoudt een mislukte load kort (failTtlMs). */
export function cached<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now, failTtlMs = 30_000): () => Promise<T> {
  // Het promise zelf wordt bewaard: gelijktijdige renders delen de lopende load, en een fout blijft failTtlMs staan.
  let entry: { promise: Promise<T>; expires: number } | undefined;
  return () => {
    if (entry && now() < entry.expires) return entry.promise;
    const current = { promise: load(), expires: Infinity };
    entry = current;
    current.promise.then(
      () => (current.expires = now() + ttlMs),
      () => (current.expires = now() + failTtlMs),
    );
    return current.promise;
  };
}
