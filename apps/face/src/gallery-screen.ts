import type { GalleryBeing, GalleryGrave } from "@animus/protocol/gallery";

export type GalleryScreen =
  | { screen: "laden" }
  | { screen: "galerij"; beings: GalleryBeing[]; graves: GalleryGrave[] }
  | { screen: "wakker-worden"; being: GalleryBeing }
  | { screen: "gezicht"; being: GalleryBeing };

/** Welk scherm hoort bij de toestand van de face. */
export function screenFor({ connected, beings, graves = [], selectedId }: { connected: boolean; beings: GalleryBeing[] | null; graves?: GalleryGrave[]; selectedId: number | null }): GalleryScreen {
  if (!connected || !beings) return { screen: "laden" };
  const being = beings.find((b) => b.id === selectedId);
  if (!being) return { screen: "galerij", beings, graves };
  return { screen: being.awake ? "gezicht" : "wakker-worden", being };
}

/** Was de gekozen Dynimo al wakker gezien en slaapt hij nu (elders) of bestaat hij niet meer: dan terug naar de Galerij. */
export function selectionLost({ selectedId, beings, sawAwake }: { selectedId: number | null; beings: GalleryBeing[]; sawAwake: boolean }): boolean {
  if (selectedId === null || !sawAwake) return false;
  return !beings.find((b) => b.id === selectedId)?.awake;
}

/** Een bestaande Dynimo die net (ergens) gewekt is: de face opent dan zijn gezicht. Pasgeborenen niet, die openen na hun animatie. */
export function justWoken({ before, after }: { before: GalleryBeing[] | null; after: GalleryBeing[] }): number | null {
  if (!before) return null;
  return after.find((b) => b.awake && before.some((p) => p.id === b.id && !p.awake))?.id ?? null;
}
