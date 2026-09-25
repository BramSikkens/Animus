// Browser-veilig: geen node-imports. De face-app én de agent delen dit contract (ADR-0018, CONTEXT.md: Waarneming).
export const PERCEPTION_TOPIC = "waarneming";

/** Bericht van agent naar face: er ging deze beurt een camerabeeld naar Type2 (kijk-event, geen payload). */
export const LOOK_TOPIC = "kijk";

/** Lengte van Human's face.embedding (@vladmandic/human 3.3.6, faceres-model), zie ADR-0020 en het research-doc. */
export const FACE_EMBEDDING_LENGTH = 1024;

/** Goedkoop, continu Type1-event uit de camera (CONTEXT.md: Waarneming). */
export type Waarneming =
  | { soort: "aanwezig" }
  | { soort: "afwezig" }
  | { soort: "nieuw-object"; object: string }
  // #93: een gezicht-embedding (base64, zie encodeEmbedding), met het aantal gezichten dat dit moment in beeld was.
  | { soort: "gezicht"; embedding: string; aantal: number };

/**
 * Aanleiding voor de agent om de initiatiefcheck uit te lokken (considerInitiative). "onbekend" (#92/#93) is geen
 * Waarneming (isWaarneming valideert hem niet): hij komt van stem- of gezichtsherkenning in de agent zelf.
 */
export type Aanleiding = { soort: "terug" } | { soort: "nieuw-object"; object: string } | { soort: "onbekend" };

// COCO-labels: lowercase woorden, gescheiden door spaties (het label komt in prompts, #87).
const OBJECT_PATTERN = /^[a-z][a-z ]{0,29}$/;

/**
 * Float32Array → base64 (#93). Browser- én node-veilig: geen Buffer (dit package heeft geen @types/node), enkel
 * atob/btoa (beide globaal beschikbaar in browser en Node ≥16). ~5,5 KB voor 1024 floats.
 */
export function encodeEmbedding(embedding: Float32Array): string {
  const bytes = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** base64 → getallen, of null bij ongeldige base64 of een lengte die geen veelvoud van 4 bytes (float32) is. */
export function decodeEmbedding(value: string): number[] | null {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length % 4 !== 0) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Array.from(new Float32Array(bytes.buffer));
}

/** Trust boundary: valideert een Waarneming die over het datachannel binnenkomt. */
export function isWaarneming(value: unknown): value is Waarneming {
  if (value === null || typeof value !== "object" || !("soort" in value)) return false;
  if (value.soort === "aanwezig" || value.soort === "afwezig") return true;
  if (value.soort === "gezicht") {
    if (!("embedding" in value) || !("aantal" in value)) return false;
    if (typeof value.embedding !== "string" || typeof value.aantal !== "number") return false;
    if (!Number.isInteger(value.aantal) || value.aantal < 1 || value.aantal > 10) return false;
    const decoded = decodeEmbedding(value.embedding);
    return decoded !== null && decoded.length === FACE_EMBEDDING_LENGTH && decoded.every(Number.isFinite);
  }
  if (value.soort !== "nieuw-object" || !("object" in value)) return false;
  return typeof value.object === "string" && OBJECT_PATTERN.test(value.object);
}
