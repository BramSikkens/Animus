import { experimental_evaluate, type Experimental_EvaluationModel } from "ai";
import { EMOTIONS, oppositeOf, type Emotion } from "./emotion.js";
import type { MoodDeltas } from "./mood.js";

export type Type1Result = { deltas: MoodDeltas; indruk: number; intent: "simpel" | "complex"; kijken: boolean };

// Type1 scoort per emotie een verandering op een schaal van 9 niveaus (de typesafe-Score ondersteunt er max 10): niveau 4
// is "geen verandering"; de tabel is niet-lineair zodat zowel kleine als grote delta's (0–100-schaal van de Stemming) kunnen.
export const DELTA_TABLE = [-100, -50, -20, -8, 0, 8, 20, 50, 100] as const;
const NEUTRAL_LEVEL = 4;

// De tegenpool remt vanzelf af (ADR-0015); Type1 hoeft die niet ook nog omlaag te scoren.
const pairHint = (emotion: Emotion) => {
  const opposite = oppositeOf(emotion);
  return opposite ? ` De tegenpool "${opposite}" zakt vanzelf mee als deze stijgt; scoor die niet apart omlaag.` : "";
};

// Eén Type1-call per beurt: per emotie de verandering (delta) die de uiting bij de Dynimo zelf teweegbrengt (reactie,
// niet de emotie van de uiting) + intent-routering. De context (persoonlijkheid, Drijfveren, Stemming) zit in de state naast de uiting.
export async function classify(type1: Experimental_EvaluationModel, text: string, context: string, canLook: boolean): Promise<Type1Result> {
  const { answers } = await experimental_evaluate({
    model: type1,
    state: `${context}\n\nUiting: ${text}`,
    questions: {
      ...Object.fromEntries(
        EMOTIONS.map((emotion) => [
          `delta_${emotion}`,
          {
            type: "score" as const,
            instructions: `Hoeveel verandert de emotie "${emotion}" van de Dynimo zelf door deze uiting, gegeven zijn persoonlijkheid, Drijfveren en huidige stemming? Het middelste niveau is geen verandering; hoger is meer, lager is minder (de emotie zakt). De meeste emoties veranderen niet; gebruik uitersten alleen voor echt sterke reacties.${pairHint(emotion)}`,
            criteria: DELTA_TABLE.map((delta) => (delta === 0 ? "geen verandering" : `${delta > 0 ? "+" : ""}${delta}`)),
          },
        ]),
      ),
      indruk: {
        type: "score",
        instructions:
          "Hoe vormend is deze uiting voor de Dynimo? Een expliciet verzoek aan de Dynimo (zoals 'praat wat minder') of een ingrijpende mededeling is hoog; gewone babbel is laag. Gebruik hoge waarden zelden.",
        criteria: ["laag", "hoog"],
      },
      intent: {
        type: "choice",
        instructions: "Vraagt deze uiting om een simpel of complex antwoord?",
        criteria: {
          simpel: "begroeting, kort praatje of eenvoudige vraag",
          complex: "vraagt uitleg, redenering, planning of een oordeel",
        },
      },
      ...(canLook && {
        kijken: {
          type: "choice" as const,
          instructions:
            "Vraagt de Gesprekspartner de Dynimo om te kijken naar wat er voor de camera is (bv. 'wat zie je?', 'kijk eens', iets tonen)? Los van of het antwoord simpel of complex is.",
          criteria: { ja: "hij moet kijken om te kunnen antwoorden", nee: "kijken is niet nodig" },
        },
      }),
    },
  });

  const deltas: MoodDeltas = {};
  for (const emotion of EMOTIONS) {
    const score = (answers as unknown as Record<string, { score: number }>)[`delta_${emotion}`]?.score ?? NEUTRAL_LEVEL;
    deltas[emotion] = DELTA_TABLE[Math.min(DELTA_TABLE.length - 1, Math.max(0, Math.round(score)))]!;
  }
  const indruk = Math.min(1, Math.max(0, answers.indruk.score));
  const intent = answers.intent.choice === "complex" ? "complex" : "simpel";
  // Zonder canLook is de vraag niet gesteld (undefined): dan geen kijken.
  const kijken = (answers as Record<string, { choice?: string } | undefined>).kijken?.choice === "ja";

  return { deltas, indruk, intent, kijken };
}
