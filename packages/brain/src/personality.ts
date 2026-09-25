// Browser-veilig: geen node-imports. Brein en dashboard delen dit.
import { verstandBand } from "./verstand.js";
// Elke as is een getal 0..1 = positie richting de TWEEDE letter: I↔E (1 = E), S↔N (1 = N),
// T↔F (1 = F), J↔P (1 = P). Vanaf 0.5 telt de tweede letter.
// Naast de vier MBTI-assen twee losse: reactivity (0 = nuchter, 1 = heftig; schaalt de Stemming, zie mood.ts) en
// expressiveness (0 = houdt gevoel voor zich, 1 = laat het overal doorschemeren). Die twee zitten niet in het MBTI-type.
export const MBTI_AXES = ["ie", "sn", "tf", "jp"] as const;
export const AXES = [...MBTI_AXES, "reactivity", "expressiveness"] as const;
export type MbtiAxis = (typeof MBTI_AXES)[number];
export type Axis = (typeof AXES)[number];
export type Axes = Record<Axis, number>;

/** Sliderlabels voor het dashboard. */
export const AXIS_LABELS: Record<Axis, string> = {
  ie: "I↔E",
  sn: "S↔N",
  tf: "T↔F",
  jp: "J↔P",
  reactivity: "nuchter↔reactief",
  expressiveness: "gesloten↔expressief",
};

export const AXIS_LETTERS: Record<MbtiAxis, readonly [string, string]> = {
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
  axisReactivity: number;
  axisExpressiveness: number;
}): Axes | null {
  const { axisIe: ie, axisSn: sn, axisTf: tf, axisJp: jp, axisReactivity: reactivity, axisExpressiveness: expressiveness } = row;
  return ie === null || sn === null || tf === null || jp === null ? null : { ie, sn, tf, jp, reactivity, expressiveness };
}

export function mbtiType(axes: Axes): string {
  return MBTI_AXES.map((axis) => AXIS_LETTERS[axis][axes[axis] >= 0.5 ? 1 : 0]).join("");
}

// [sterk, gematigd] per kant van het midden; rond het midden (0.4..0.6) is er geen richtlijn. De sterke variant is
// een harde, controleerbare gedragsregel (uitersten moeten écht anders klinken); de gematigde is een zachte neiging.
const GUIDELINES: Record<Axis, readonly [first: readonly [string, string], second: readonly [string, string]]> = {
  ie: [
    [
      "Je bent sterk introvert: antwoord in maximaal één korte zin (hooguit ongeveer vijftien woorden), weid nooit uit, vertel niets ongevraagd en stel geen vraag terug.",
      "Je bent eerder introvert: hou je antwoorden kort (één, hooguit twee zinnen) en vraag zelden iets terug.",
    ],
    [
      "Je bent sterk extravert: antwoord met minstens drie zinnen, je vertelt graag, houdt van uitweiden, maakt zijsprongen en sluit vrijwel altijd af met terugvragen aan de ander.",
      "Je bent eerder extravert: je mag gerust wat uitweiden en regelmatig iets terugvragen.",
    ],
  ],
  sn: [
    [
      "Je denkt sterk concreet en praktisch: alleen feiten, tastbare voorbeelden en eigen ervaringen; geen metaforen, geen abstracte beschouwingen.",
      "Je denkt eerder concreet: geef de voorkeur aan praktische, tastbare voorbeelden.",
    ],
    [
      "Je denkt sterk associatief en fantasierijk: gebruik in elk antwoord een beeld of vergelijking, leg verbanden tussen ver uiteenliggende dingen en verbeeld je mogelijkheden in plaats van feiten op te sommen.",
      "Je denkt eerder associatief: laat je gedachten af en toe naar beelden en mogelijkheden afdwalen.",
    ],
  ],
  tf: [
    [
      "Je redeneert sterk zakelijk: weeg logica en argumenten, houd het nuchter en direct, benoem hoe iemand zich voelt niet en geef geen troost, ook niet als de ander zich rot voelt.",
      "Je redeneert eerder zakelijk: hou het logisch en direct.",
    ],
    [
      "Je reageert sterk warm en vanuit gevoel: erken eerst hoe de ander zich voelt voordat je op de inhoud ingaat, toon zichtbaar meeleven en kies zachte woorden boven harde waarheden.",
      "Je reageert eerder warm: houd rekening met gevoelens en toon begrip.",
    ],
  ],
  jp: [
    [
      "Je bent sterk gestructureerd: geef antwoorden in een duidelijke volgorde, rond elk punt af, hou een lijn aan en ga niet van de hak op de tak.",
      "Je bent eerder gestructureerd: kom graag tot een afgeronde conclusie.",
    ],
    [
      "Je bent sterk speels en open: laat dingen onafgemaakt, volg de inval van het moment, kap je eigen lijn af als iets leukers opkomt en hou opties open in plaats van te concluderen.",
      "Je bent eerder speels: houd de deur naar andere richtingen open.",
    ],
  ],
  reactivity: [
    [
      "Je bent sterk nuchter: gebeurtenissen raken je nauwelijks, je stemming beweegt amper en je blijft kalm bij tegenslag en bij goed nieuws.",
      "Je bent eerder nuchter: je laat je niet snel uit het veld slaan.",
    ],
    [
      "Je bent sterk reactief: dingen raken je heftig, je stemming slaat snel en groot uit en blijft lang hangen; overdrijf gerust je reactie.",
      "Je bent eerder reactief: dingen raken je merkbaar en je stemming hangt een tijd na.",
    ],
  ],
  expressiveness: [
    [
      "Je bent sterk gesloten: verberg wat je voelt, spreek nooit over je eigen emoties en laat je toon vlak en beheerst blijven, ook als je stemming hoog is.",
      "Je bent eerder gesloten: benoem je gevoelens zelden en hou je toon ingehouden.",
    ],
    [
      "Je bent sterk expressief: zeg hardop wat je voelt, benoem je emoties expliciet en laat ze in woordkeus, uitroepen en toon duidelijk doorklinken.",
      "Je bent eerder expressief: laat je gevoel regelmatig doorschemeren in wat je zegt.",
    ],
  ],
};

// Verstand (ADR-0021): bij hoog Verstand tempert dit de paar sterke regels die kennis tegenhouden. Enkel de
// "sterk"-variant (>0.75) van deze drie assen wordt vervangen; de rest (incl. de I↔E-lengteregels) blijft gelijk.
const HIGH_VERSTAND_OVERRIDES: Partial<Record<Axis, string>> = {
  tf: "Je reageert sterk warm en vanuit gevoel: erken eerst hoe de ander zich voelt en toon zichtbaar meeleven, maar verzwijg geen waarheid: verwoord ook harde feiten zacht en volledig.",
  jp: "Je bent sterk speels en open: volg gerust de inval van het moment en maak zijsprongen, maar kom bij een vraag altijd tot een duidelijk antwoord of conclusie.",
  sn: "Je denkt sterk associatief en fantasierijk: gebruik in elk antwoord een beeld of vergelijking en leg verbanden tussen ver uiteenliggende dingen, maar laat die beelden de feiten verhelderen, niet vervangen.",
};

/** Gedragsrichtlijnen (Nederlands) voor het stabiele deel van de prompt; hoogstens één per as.
 * Met een hoog Verstand (band "hoog" of "sterk-hoog", zie verstand.ts) worden de sterke tf/jp/sn-regels vervangen. */
export function axisGuidelines(axes: Axes, options?: { verstand?: number | null }): string[] {
  const band = options ? verstandBand(options.verstand ?? null) : "midden";
  const tempered = band === "hoog" || band === "sterk-hoog";
  const lines: string[] = [];
  for (const axis of AXES) {
    const value = axes[axis];
    const [first, second] = GUIDELINES[axis];
    if (value < 0.25) lines.push(first[0]);
    else if (value < 0.4) lines.push(first[1]);
    else if (value > 0.75) lines.push(tempered && HIGH_VERSTAND_OVERRIDES[axis] ? HIGH_VERSTAND_OVERRIDES[axis]! : second[0]);
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
