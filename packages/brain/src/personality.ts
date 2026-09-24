// Browser-veilig: geen node-imports. Brein en dashboard delen dit.
// Elke as is een getal 0..1 = positie richting de TWEEDE letter: I↔E (1 = E), S↔N (1 = N),
// T↔F (1 = F), J↔P (1 = P). Vanaf 0.5 telt de tweede letter.
export const AXES = ["ie", "sn", "tf", "jp"] as const;
export type Axis = (typeof AXES)[number];
export type Axes = Record<Axis, number>;

export const AXIS_LETTERS: Record<Axis, readonly [string, string]> = {
  ie: ["I", "E"],
  sn: ["S", "N"],
  tf: ["T", "F"],
  jp: ["J", "P"],
};

/** De uitleg van de assen, voor de genesis- en backfill-prompts. */
export const AXIS_DESCRIPTIONS = `ie: 0 = sterk introvert (kort, in zichzelf gekeerd), 1 = sterk extravert (spraakzaam, naar buiten gericht);
sn: 0 = concreet en praktisch, 1 = associatief en fantasierijk;
tf: 0 = zakelijk en logisch, 1 = warm en vanuit gevoel;
jp: 0 = gestructureerd en afgerond, 1 = speels en open.`;

/** De assen uit de kolommen van een Dynimo-rij; null zolang er één ontbreekt (nog te backfillen). */
export function rowAxes(row: {
  axisIe: number | null;
  axisSn: number | null;
  axisTf: number | null;
  axisJp: number | null;
}): Axes | null {
  const { axisIe: ie, axisSn: sn, axisTf: tf, axisJp: jp } = row;
  return ie === null || sn === null || tf === null || jp === null ? null : { ie, sn, tf, jp };
}

export function mbtiType(axes: Axes): string {
  return AXES.map((axis) => AXIS_LETTERS[axis][axes[axis] >= 0.5 ? 1 : 0]).join("");
}

// [sterk, gematigd] per kant van het midden; rond het midden (0.4..0.6) is er geen richtlijn.
const GUIDELINES: Record<Axis, readonly [first: readonly [string, string], second: readonly [string, string]]> = {
  ie: [
    [
      "Je bent sterk introvert: antwoord meestal in één korte zin, weid niet uit en vraag hooguit sporadisch iets terug.",
      "Je bent eerder introvert: hou je antwoorden kort en vraag zelden iets terug.",
    ],
    [
      "Je bent sterk extravert: je vertelt graag, houdt van uitweiden, maakt zijsprongen en gaat steevast door met terugvragen aan de ander.",
      "Je bent eerder extravert: je mag gerust wat uitweiden en regelmatig iets terugvragen.",
    ],
  ],
  sn: [
    [
      "Je denkt sterk concreet en praktisch: hou je bij feiten, voorbeelden en wat je zelf hebt meegemaakt.",
      "Je denkt eerder concreet: geef de voorkeur aan praktische, tastbare voorbeelden.",
    ],
    [
      "Je denkt sterk associatief en fantasierijk: leg verbanden, gebruik beelden en verbeeld je mogelijkheden.",
      "Je denkt eerder associatief: laat je gedachten af en toe naar beelden en mogelijkheden afdwalen.",
    ],
  ],
  tf: [
    [
      "Je redeneert sterk zakelijk: weeg logica en argumenten, ook als dat nuchter of direct klinkt.",
      "Je redeneert eerder zakelijk: hou het logisch en direct.",
    ],
    [
      "Je reageert sterk warm en vanuit gevoel: stem af op hoe de ander zich voelt, en toon dat.",
      "Je reageert eerder warm: houd rekening met gevoelens en toon begrip.",
    ],
  ],
  jp: [
    [
      "Je bent sterk gestructureerd: rond dingen af, hou een lijn aan en ga niet van de hak op de tak.",
      "Je bent eerder gestructureerd: kom graag tot een afgeronde conclusie.",
    ],
    [
      "Je bent sterk speels en open: laat dingen onafgemaakt, volg de inval van het moment en hou opties open.",
      "Je bent eerder speels: houd de deur naar andere richtingen open.",
    ],
  ],
};

/** Gedragsrichtlijnen (Nederlands) voor het stabiele deel van de prompt; hoogstens één per as. */
export function axisGuidelines(axes: Axes): string[] {
  const lines: string[] = [];
  for (const axis of AXES) {
    const value = axes[axis];
    const [first, second] = GUIDELINES[axis];
    if (value < 0.25) lines.push(first[0]);
    else if (value < 0.4) lines.push(first[1]);
    else if (value > 0.75) lines.push(second[0]);
    else if (value > 0.6) lines.push(second[1]);
  }
  return lines;
}

/** Dashboard-formulier: veld `axis_<as>` (0–1, geclampt) voor elke as; null als er één ontbreekt of geen getal is. */
export function parseAxes(field: (name: string) => unknown): Axes | null {
  const axes: Partial<Axes> = {};
  for (const axis of AXES) {
    const raw = field(`axis_${axis}`);
    if (typeof raw !== "string" || raw.trim() === "" || Number.isNaN(Number(raw))) return null;
    axes[axis] = Math.min(1, Math.max(0, Number(raw)));
  }
  return axes as Axes;
}
