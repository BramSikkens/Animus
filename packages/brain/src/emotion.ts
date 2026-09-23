// Browser-veilig: geen node-imports. De gezichtje-app importeert dit rechtstreeks.
export const EMOTIONS = ["blij", "boos", "verrast", "kalm", "verveeld", "nieuwsgierig", "bang", "neutraal"] as const;
export type Emotion = (typeof EMOTIONS)[number];
