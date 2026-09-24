import type { DisplayState } from "@animus/brain/display";
import type { Emotion } from "@animus/brain/emotion";

/** Overlay-offsets: browRaise in viewBox-eenheden (omhoog), frown 0..1 (brauw omlaag), smile (extra mondkromming, Keyframe-`curve`-eenheden). */
export type MicroExpression = { browRaise: number; frown: number; smile: number };

const QUESTION_BROW_RAISE = 3;
const FROWN_FROM = 60;
const SMILE_CURVE = 0.5;
const COMPLIMENT = /\b(goed gedaan|lief|top|mooi|bedankt|dank je)\b/i;

export function microExpression({ displayState, lastUserText, values }: { displayState: DisplayState; lastUserText?: string; values?: Record<Emotion, number> }): MicroExpression {
  // Vraag: tijdens luisteren, of net erna (reflecterend/spreekt: de tekst is dan nog "vers").
  const asking = displayState !== "slapend" && displayState !== "wakker" && !!lastUserText?.trimEnd().endsWith("?");
  const boos = displayState === "slapend" ? 0 : (values?.boos ?? 0);
  // Lineair van net boven 0 bij de drempel naar 1 bij 100.
  const frown = boos >= FROWN_FROM ? Math.min(1, (boos - 50) / 50) : 0;
  const complimented = displayState !== "slapend" && !!lastUserText && COMPLIMENT.test(lastUserText);
  return { browRaise: asking ? QUESTION_BROW_RAISE : 0, frown, smile: complimented ? SMILE_CURVE : 0 };
}
