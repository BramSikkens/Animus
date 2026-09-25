// Server-side ElevenLabs voice design/cloning. Alleen op de server gebruiken: de API-key mag nooit naar de client of in logs.
const API = "https://api.elevenlabs.io/v1";

export type DesignPreview = { generatedVoiceId: string; audioBase64: string; mediaType: string };

type Raw = Record<string, unknown>;

function requireKey(apiKey: string) {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY ontbreekt: stemontwerp is niet beschikbaar.");
}

/** Gooit een leesbare Nederlandse fout; bevat nooit de key of de response-body. */
function assertOk(response: Response) {
  if (response.ok) return;
  const { status } = response;
  if (status === 401) throw new Error("ElevenLabs weigerde de API-key (401). Controleer ELEVENLABS_API_KEY.");
  if (status === 402 || status === 429) throw new Error(`ElevenLabs-limiet of tegoed bereikt (${status}). Probeer het later opnieuw.`);
  if (status === 422) throw new Error("ElevenLabs weigerde de invoer als ongeldig (422).");
  throw new Error(`ElevenLabs gaf status ${status}`);
}

export async function designVoice(fetchFn: typeof fetch, apiKey: string, description: string, previewText: string): Promise<DesignPreview[]> {
  requireKey(apiKey);
  if (!description.trim()) throw new Error("Vul een stembeschrijving in.");
  if (previewText.length < 100 || previewText.length > 1000) throw new Error("De previewtekst moet tussen 100 en 1000 tekens zijn.");
  const response = await fetchFn(`${API}/text-to-voice/design`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ voice_description: description, text: previewText, model_id: "eleven_multilingual_ttv_v2" }),
  });
  assertOk(response);
  const body = (await response.json()) as Raw;
  return ((body.previews ?? []) as Raw[]).map((p) => ({
    generatedVoiceId: String(p.generated_voice_id),
    audioBase64: String(p.audio_base_64),
    mediaType: String(p.media_type ?? "audio/mpeg"),
  }));
}

/** Slaat een gekozen preview op als blijvende stem; geeft het voice_id. */
export async function saveDesignedVoice(
  fetchFn: typeof fetch,
  apiKey: string,
  voice: { name: string; description: string; generatedVoiceId: string },
): Promise<string> {
  requireKey(apiKey);
  if (!voice.name.trim()) throw new Error("Geef de stem een naam.");
  if (!voice.generatedVoiceId) throw new Error("Kies eerst een preview.");
  const response = await fetchFn(`${API}/text-to-voice`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ voice_name: voice.name, voice_description: voice.description, generated_voice_id: voice.generatedVoiceId }),
  });
  assertOk(response);
  return String(((await response.json()) as Raw).voice_id);
}

export const MAX_CLONE_BYTES = 10 * 1024 * 1024;

/** Kloont een stem uit eigen opnames (instant voice cloning). Zonder `consent` wordt niets verstuurd. */
export async function cloneVoice(fetchFn: typeof fetch, apiKey: string, input: { name: string; files: File[]; consent: boolean }): Promise<string> {
  requireKey(apiKey);
  if (!input.consent) throw new Error("Bevestig dat je het recht hebt deze stem te gebruiken.");
  if (!input.name.trim()) throw new Error("Geef de stem een naam.");
  if (input.files.length === 0) throw new Error("Upload minstens één opname.");
  for (const file of input.files) {
    if (!file.type.startsWith("audio/")) throw new Error(`"${file.name}" is geen audiobestand.`);
    if (file.size > MAX_CLONE_BYTES) throw new Error(`"${file.name}" is groter dan 10 MB.`);
  }
  const form = new FormData();
  form.append("name", input.name.trim());
  for (const file of input.files) form.append("files", file);
  const response = await fetchFn(`${API}/voices/add`, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  assertOk(response);
  return String(((await response.json()) as Raw).voice_id);
}

/** TTS kent een Voice Library-stem pas na toevoegen aan het account; geeft het bruikbare voice_id. Eigen stemmen: ongewijzigd. */
export async function adoptVoice(fetchFn: typeof fetch, apiKey: string, voice: { id: string; name: string; publicOwnerId?: string }): Promise<string> {
  if (!voice.publicOwnerId) return voice.id;
  requireKey(apiKey);
  const response = await fetchFn(`${API}/voices/add/${encodeURIComponent(voice.publicOwnerId)}/${encodeURIComponent(voice.id)}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ new_name: voice.name }),
  });
  assertOk(response);
  return String(((await response.json()) as Raw).voice_id);
}
