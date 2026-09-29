// Browser-veilig: geen node-imports. De agent én de gezichtje-app delen dit contract.
// De weergavetoestand staat naast de Emotiekeyframes: de emotieset blijft ongewijzigd.
export const DISPLAY_STATES = ["wakker", "reflecterend", "slapend", "luisterend", "spreekt"] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

export function isDisplayState(value: unknown): value is DisplayState {
  return typeof value === "string" && (DISPLAY_STATES as readonly string[]).includes(value);
}
