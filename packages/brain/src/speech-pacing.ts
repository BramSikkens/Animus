// Browser-veilig: geen node-imports. Pure pauzes en tempo per Emotie voor TTS (ElevenLabs Flash kent geen SSML/break-tag:
// pauzes gaan via interpunctie in de tekst, tempo via voiceSettings.speed).
import type { Emotion } from "./emotion.js";
import { strength, type MoodValues } from "./mood.js";

export type Pacing = { pauseLevel: 0 | 1 | 2; speedFactor: number; /** bang: extra '…' bij komma's. */ halting: boolean };

/** Onder deze gewogen waarde (waarde/100 × expressiviteit) van de dominante Emotie blijft alles neutraal. */
export const PACING_MIN_WEIGHT = 0.25;

/** Tempo-verschuiving bij gewicht 1 en pauzeniveau (1 = kort, 2 = lang) per Emotie. */
const PROFILES: Partial<Record<Emotion, { speed: number; pauseLevel: 1 | 2; halting?: boolean }>> = {
  blij: { speed: 0.1, pauseLevel: 1 },
  druk: { speed: 0.12, pauseLevel: 1 },
  verrast: { speed: 0.08, pauseLevel: 1 },
  bang: { speed: 0, pauseLevel: 1, halting: true },
  droevig: { speed: -0.12, pauseLevel: 2 },
  vredig: { speed: -0.1, pauseLevel: 2 },
  kalm: { speed: -0.08, pauseLevel: 2 },
  verveeld: { speed: -0.15, pauseLevel: 2 },
};

export function pacingFor({ values, expressiveness }: { values: MoodValues; expressiveness: number }): Pacing {
  const [top, value] = (Object.entries(values) as [Emotion, number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
  const profile = PROFILES[top];
  const weight = strength(value) * Math.min(1, Math.max(0, expressiveness));
  if (!profile || weight < PACING_MIN_WEIGHT) return { pauseLevel: 0, speedFactor: 1, halting: false };
  return { pauseLevel: profile.pauseLevel, speedFactor: 1 + profile.speed * weight, halting: profile.halting ?? false };
}

const PAUSE = " … ";
/** Zinnen langer dan dit krijgen al op niveau 1 een pauze. */
export const LONG_SENTENCE = 40;
/** Op niveau 2 krijgt een komma pas een pauze na zoveel tekens voorafgaande deelzin. */
export const LONG_CLAUSE = 20;
const ABBREVIATIONS = new Set(["bijv", "bv", "enz", "etc", "o.a", "d.w.z", "m.n", "t.a.v", "dr", "mr", "drs", "ir", "prof", "nr", "ca", "vs", "blz", "evt", "resp", "max", "min", "st"]);

type Carry = { sentence: number; clause: number };

/** Kan `token` (woord vóór een punt) een afkorting of getal zijn i.p.v. een zinseinde? */
function isNoBoundary(token: string, next: string): boolean {
  const word = token.replace(/^[("'“]+/, "").replace(/\.$/, "");
  return /^\d+$/.test(word) || word.length === 1 || word.includes(".") || ABBREVIATIONS.has(word.toLowerCase()) || /\p{Ll}/u.test(next);
}

/** Interpunctie-pauzes; `used` = tot waar de tekst definitief verwerkt is (na het laatst gevonden zinseinde/komma en de eerstvolgende letter). */
function pace(text: string, level: 0 | 1 | 2, halting: boolean, final: boolean, carry: Carry): { out: string; used: number; carry: Carry } {
  let out = "";
  let last = 0;
  let used = 0;
  let sentenceStart = -carry.sentence;
  let clauseStart = -carry.clause;
  for (const m of text.matchAll(/([.!?,])(\s+)(?=\S)/g)) {
    const idx = m.index!;
    const end = idx + 1 + m[2]!.length;
    const next = text[end]!;
    used = end;
    if (next === "…") continue;
    let pause = false;
    if (m[1] === ",") {
      pause = halting || (level === 2 && idx - clauseStart >= LONG_CLAUSE);
      clauseStart = end;
    } else {
      if (text[idx - 1] === "." || isNoBoundary(text.slice(0, idx + 1).split(/\s+/).pop()!, next)) continue;
      pause = level === 2 || idx + 1 - sentenceStart > LONG_SENTENCE;
      sentenceStart = clauseStart = end;
    }
    if (pause) {
      out += text.slice(last, idx + 1) + PAUSE;
      last = end;
    }
  }
  out += text.slice(last, final ? text.length : used);
  return { out, used: final ? text.length : used, carry: { sentence: used - sentenceStart, clause: used - clauseStart } };
}

/** Voegt op zinsgrenzen (en op niveau 2 / haperend ook bij komma's) een '…' toe. Puur en deterministisch. */
export function applyPauses(text: string, pauseLevel: 0 | 1 | 2, halting = false): string {
  return pauseLevel === 0 ? text : pace(text, pauseLevel, halting, true, { sentence: 0, clause: 0 }).out;
}

/** Streaming-variant: de eerste zin gaat direct en zonder pauze door (latentie: geen buffer vóór de eerste audio); daarna geeft `push` vrij wat definitief is (tot het laatste zinseinde/komma + eerstvolgende letter), `flush` de rest. Niveau 0 = doorgeven. */
export function createPacer(pauseLevel: 0 | 1 | 2, halting = false): { push(delta: string): string; flush(): string } {
  let buffer = "";
  let carry: Carry = { sentence: 0, clause: 0 };
  let first = ""; // de tot nu toe doorgegeven eerste zin; "" zodra die klaar is (ponytail: afkortingen tellen als zinseinde, kost hooguit één pauze)
  let inFirst = true;
  const step = (final: boolean): string => {
    const r = pace(buffer, pauseLevel as 1 | 2, halting, final, carry);
    buffer = buffer.slice(r.used);
    carry = r.carry;
    return r.out;
  };
  if (pauseLevel === 0) return { push: (delta) => delta, flush: () => "" };
  return {
    push(delta) {
      if (inFirst) {
        const before = first.length;
        first += delta;
        const m = /[.!?]\s+/.exec(first);
        if (!m) return delta;
        inFirst = false;
        const cut = m.index + m[0].length - before;
        buffer = delta.slice(cut);
        return delta.slice(0, cut) + step(false);
      }
      buffer += delta;
      return step(false);
    },
    flush: () => step(true),
  };
}

/** Vermenigvuldigt `speed` met de tempo-factor (ElevenLabs-limiet 0.7-1.2); de afronding/dedupe gebeurt in applyTtsEmotion. */
export function withPacingSpeed<T extends { speed: number }>(settings: T, speedFactor: number): T {
  return { ...settings, speed: Math.min(1.2, Math.max(0.7, settings.speed * speedFactor)) };
}
