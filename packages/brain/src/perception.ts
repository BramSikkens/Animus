// Browser-veilig: geen node-imports. De face-app én de agent delen dit contract (ADR-0018, CONTEXT.md: Waarneming).
export const PERCEPTION_TOPIC = "waarneming";

/** Bericht van agent naar face: er ging deze beurt een camerabeeld naar Type2 (kijk-event, geen payload). */
export const LOOK_TOPIC = "kijk";

/** Goedkoop, continu Type1-event uit de camera (CONTEXT.md: Waarneming). */
export type Waarneming = { soort: "aanwezig" } | { soort: "afwezig" } | { soort: "nieuw-object"; object: string };

/** Aanleiding voor de agent om de initiatiefcheck uit te lokken (considerInitiative). */
export type Aanleiding = { soort: "terug" } | { soort: "nieuw-object"; object: string };

// COCO-labels: lowercase woorden, gescheiden door spaties (het label komt in prompts, #87).
const OBJECT_PATTERN = /^[a-z][a-z ]{0,29}$/;

/** Trust boundary: valideert een Waarneming die over het datachannel binnenkomt. */
export function isWaarneming(value: unknown): value is Waarneming {
  if (value === null || typeof value !== "object" || !("soort" in value)) return false;
  if (value.soort === "aanwezig" || value.soort === "afwezig") return true;
  if (value.soort !== "nieuw-object" || !("object" in value)) return false;
  return typeof value.object === "string" && OBJECT_PATTERN.test(value.object);
}
