// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
import type { DisplayState } from "@animus/core/display";

/** Bericht op het LiveKit data channel, van agent naar gezichtje. */
export type DisplayMessage = {
  state: DisplayState;
  /** Naam van de wakkere Dynimo (null: niemand wakker). Alleen bij een volledige toestandspublicatie; afwezig = ongewijzigd. */
  name?: string | null;
};
export const DISPLAY_TOPIC = "display";
