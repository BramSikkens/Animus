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
  | { screen: "wakker-worden"; being: GalleryBeing }
  | { screen: "gezicht"; being: GalleryBeing };

/** Welk scherm hoort bij de toestand van de face. */
export function screenFor({ connected, beings, selectedId }: { connected: boolean; beings: GalleryBeing[] | null; selectedId: number | null }): GalleryScreen {
  if (!connected || !beings) return { screen: "laden" };
  const being = beings.find((b) => b.id === selectedId);
  if (!being) return { screen: "galerij", beings };
  return { screen: being.awake ? "gezicht" : "wakker-worden", being };
}

/** Was de gekozen Dynimo al wakker gezien en slaapt hij nu (elders) of bestaat hij niet meer: dan terug naar de Galerij. */
export function selectionLost({ selectedId, beings, sawAwake }: { selectedId: number | null; beings: GalleryBeing[]; sawAwake: boolean }): boolean {
  if (selectedId === null || !sawAwake) return false;
  return !beings.find((b) => b.id === selectedId)?.awake;
}
