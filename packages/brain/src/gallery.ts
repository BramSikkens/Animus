// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.

/** Eén levende Dynimo in de Galerij. */
export type GalleryBeing = { id: number; name: string; awake: boolean };

/** Bericht van agent naar gezichtje: alle levende Dynimo's. */
export type GalleryMessage = { beings: GalleryBeing[] };
export const GALLERY_TOPIC = "gallery";

/** Commando van gezichtje naar agent. Dev-only, zonder auth: de agent valideert met `parseCommand`. */
export type GalleryCommand = { type: "wake" | "sleep"; id: number };
export const COMMAND_TOPIC = "command";

/** Geeft een geldig commando terug, of null bij alles wat er niet exact zo uitziet. */
export function parseCommand(value: unknown): GalleryCommand | null {
  if (value === null || typeof value !== "object") return null;
  const { type, id } = value as Record<string, unknown>;
  if ((type !== "wake" && type !== "sleep") || typeof id !== "number" || !Number.isInteger(id)) return null;
  return { type, id };
}

export type GalleryScreen =
  | { screen: "laden" }
  | { screen: "galerij"; beings: GalleryBeing[] }
  | { screen: "gezicht"; awake: GalleryBeing };

/** Welk scherm hoort bij de lijst: onbekend = laden, iemand wakker = zijn gezicht, anders de Galerij. */
export function galleryView(beings: GalleryBeing[] | null): GalleryScreen {
  if (!beings) return { screen: "laden" };
  const awake = beings.find((being) => being.awake);
  return awake ? { screen: "gezicht", awake } : { screen: "galerij", beings };
}
