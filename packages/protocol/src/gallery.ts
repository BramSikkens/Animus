// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.

/** Eén levende Dynimo in de Galerij; `bornAt` als ISO-string (voor de leeftijd). */
export type GalleryBeing = { id: number; name: string; awake: boolean; bornAt: string };

/** Eén gestorvene (Grafschrift) in de Galerij; datums als ISO-string, `farewell` is de Afscheidsreflectie. */
export type GalleryGrave = { id: number; name: string; bornAt: string; deletedAt: string; farewell: string };

/** Bericht van agent naar gezichtje: alle levende Dynimo's plus (laatste 50) gestorvenen. */
export type GalleryMessage = { beings: GalleryBeing[]; graves: GalleryGrave[] };
export const GALLERY_TOPIC = "gallery";

const isGrave = (g: unknown): g is GalleryGrave => {
  const r = g as Record<string, unknown> | null;
  return !!r && typeof r.id === "number" && ["name", "bornAt", "deletedAt", "farewell"].every((k) => typeof r[k] === "string");
};

/** Valideert een binnenkomend bericht; ontbrekende/kapotte `graves` (ouder bericht) worden [], ongeldige graven overgeslagen. */
export function parseGalleryMessage(value: unknown): GalleryMessage | null {
  if (value === null || typeof value !== "object") return null;
  const { beings, graves } = value as Record<string, unknown>;
  if (!Array.isArray(beings) || !beings.every((b) => b && typeof b.id === "number" && typeof b.name === "string" && typeof b.awake === "boolean" && typeof b.bornAt === "string")) return null;
  return {
    beings: beings.map((b) => ({ id: b.id, name: b.name, awake: b.awake, bornAt: b.bornAt })),
    graves: Array.isArray(graves) ? graves.filter(isGrave).map((g) => ({ id: g.id, name: g.name, bornAt: g.bornAt, deletedAt: g.deletedAt, farewell: g.farewell })) : [],
  };
}

/** Commando van gezichtje naar agent. Dev-only, zonder auth: de agent valideert met `parseCommand`. */
export type GalleryCommand = { type: "wake" | "sleep"; id: number } | { type: "kill"; id: number; name: string } | { type: "birth" };
export const COMMAND_TOPIC = "command";

/** Geeft een geldig commando terug, of null bij alles wat er niet exact zo uitziet. */
export function parseCommand(value: unknown): GalleryCommand | null {
  if (value === null || typeof value !== "object") return null;
  const { type, id, name } = value as Record<string, unknown>;
  if (type === "birth") return { type };
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  // kill vraagt de bevestigde naam mee; de Animus vergelijkt die zelf met de database.
  if (type === "kill") return typeof name === "string" ? { type, id, name } : null;
  if (type !== "wake" && type !== "sleep") return null;
  return { type, id };
}
