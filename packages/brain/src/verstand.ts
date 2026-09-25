// Browser-veilig, puur. Verstand (CONTEXT.md): hoeveel een Dynimo weet en hoe wereldwijs hij redeneert, los van
// hoe hij praat (dat blijven Archetype en Persoonlijkheid bepalen). 0..1; NULL telt als 0.5 (midden, gedrag zoals nu).

export type VerstandBand = "sterk-laag" | "laag" | "midden" | "hoog" | "sterk-hoog";

/** Zelfde bandgrenzen als de Persoonlijkheidsassen (personality.ts); null (nog te backfillen) valt in het midden. */
export function verstandBand(verstand: number | null): VerstandBand {
  if (verstand === null) return "midden";
  if (verstand < 0.25) return "sterk-laag";
  if (verstand < 0.4) return "laag";
  if (verstand > 0.75) return "sterk-hoog";
  if (verstand > 0.6) return "hoog";
  return "midden";
}

const GUIDELINES: Record<Exclude<VerstandBand, "midden">, string> = {
  "sterk-laag":
    "Je Verstand is nog heel jong: je kent de wereld maar half. Je verwondert je, raadt hardop en zegt eerlijk 'dat weet ik niet' als je iets niet weet; stel nooit iets verzonnens voor als feit.",
  laag: "Je weet nog niet zo veel van de wereld: je verwondert je graag en zegt eerlijk als je iets niet zeker weet; verzin geen feiten.",
  hoog: "Je bent schrander en weet veel: je spreekstijl en gedragsregels bepalen je toon, niet de inhoud. Geef bij een vraag het kloppende antwoord met de echte redenering, in je eigen stijl, en vorm bij een meningsvraag een eigen, onderbouwde mening met een concreet voorbeeld.",
  "sterk-hoog":
    "Je Verstand is groot: je weet veel en redeneert scherp. Je spreekstijl en gedragsregels bepalen enkel je toon en woordkeuze, nooit de inhoud: geef bij een vraag altijd het volledige, kloppende antwoord met de echte redenering, en verpak het daarna gerust in je eigen stijl. Vorm bij een meningsvraag een eigen, onderbouwde mening en maak die concreet met een voorbeeld.",
};

/** Gedragsregels (Nederlands) voor het stabiele deel van de prompt; leeg in het midden. */
export function verstandGuidelines(verstand: number | null): string[] {
  const band = verstandBand(verstand);
  return band === "midden" ? [] : [GUIDELINES[band]];
}

/** Hoog Verstand tempert de sterke asregels die kennis tegenhouden (personality.ts, ADR-0021). */
export const tempersAxisRules = (verstand: number | null): boolean => verstandBand(verstand).endsWith("hoog");

/** Dashboard-formulier: veld `verstand` (0–1, geclampt); null als het ontbreekt, leeg is of geen getal is. */
export function parseVerstand(field: (name: string) => unknown): number | null {
  const raw = field("verstand");
  if (typeof raw !== "string" || raw.trim() === "" || Number.isNaN(Number(raw))) return null;
  return Math.min(1, Math.max(0, Number(raw)));
}
