// Browser-veilig, puur. Standpunt (CONTEXT.md): een Drijfveer die duidelijk raakt aan de uiting geeft de Dynimo een eigen mening.
import { DRIVE_LABELS, isActiveDrive, type DriveRow } from "./drives.js";
import type { Axes } from "./personality.js";

export type OpinionKind = "geen" | "tegenspraak" | "voorkeur" | "saai";
export type OpinionDecision = { kind: OpinionKind; driveId?: number };

/** Minimale score (0..1) waarmee een Drijfveer 'duidelijk' matcht met de uiting. */
export const OPINION_MATCH_THRESHOLD = 0.5;
/** Minstens zoveel beurten sinds het vorige Standpunt (dus max. één per N beurten). */
export const OPINION_COOLDOWN_TURNS = 4;

/** Basiskans op een Standpunt bij een match, vóór schaling met persoonlijkheid. */
export const OPINION_BASE_CHANCE = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function decideOpinion({
  drives,
  utteranceMatches,
  axes,
  rng,
  lastOpinionTurnsAgo,
}: {
  drives: readonly DriveRow[];
  utteranceMatches: readonly { driveId: number; score: number }[];
  axes: Axes;
  rng: () => number;
  lastOpinionTurnsAgo?: number;
}): OpinionDecision {
  if (lastOpinionTurnsAgo !== undefined && lastOpinionTurnsAgo < OPINION_COOLDOWN_TURNS) return { kind: "geen" };
  const best = utteranceMatches.filter((m) => m.score >= OPINION_MATCH_THRESHOLD).sort((a, b) => b.score - a.score)[0];
  const drive = best && drives.find((d) => d.id === best.driveId);
  if (!drive) return { kind: "geen" };
  const expressive = 0.5 + axes.expressiveness;
  if (drive.kind !== "ergernis") {
    return rng() < clamp01(OPINION_BASE_CHANCE * expressive) ? { kind: "voorkeur", driveId: drive.id } : { kind: "geen" };
  }
  // Ergernis: zakelijk (T, tf laag) en stellig (J, jp laag) geeft vaker een Standpunt; warm (F) kiest vaker 'saai' dan tegenspraak.
  const chance = OPINION_BASE_CHANCE * (0.4 + 0.6 * (1 - axes.tf)) * (0.5 + 0.5 * (1 - axes.jp)) * expressive;
  if (rng() >= clamp01(chance)) return { kind: "geen" };
  return { kind: rng() < 0.2 + 0.7 * (1 - axes.tf) ? "tegenspraak" : "saai", driveId: drive.id };
}

// Matching: woord-overlap i.p.v. embeddings. Drijfveren hebben geen opgeslagen embedding; die per beurt (of per
// Drijfveer) via het netwerk ophalen is niet gratis. ponytail: geen stemming ('komt' ≠ 'komen'); upgrade naar
// gecachete Drijfveer-embeddings als de dekking tekortschiet.
const STOPWORDS = new Set(
  `de het een en of maar want dat die dit dus dan als ook nog wel niet geen ik je jij jouw mijn me mij we wij ze zij hij het ons u
  is ben bent zijn was waren wordt worden heb hebt heeft hebben kan kun kunt kunnen zal zou wil willen wilt graag moet moeten
  aan bij in op uit van voor met naar om te tot door over onder tegen na er hier daar wat wie waar hoe waarom wanneer zo erg heel
  te veel weinig meer nog al alle alles iets niets`.split(/\s+/),
);

const words = (text: string): Set<string> =>
  new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word)));

/** Per actieve Drijfveer met overlap: gedeelde inhoudswoorden / het kleinste van de twee woordenlijsten (0..1). */
export function matchDrives(utterance: string, rows: readonly DriveRow[]): { driveId: number; score: number }[] {
  const said = words(utterance);
  const matches: { driveId: number; score: number }[] = [];
  for (const row of rows) {
    if (!isActiveDrive(row)) continue;
    const own = words(row.text);
    const shared = [...own].filter((word) => said.has(word)).length;
    // Eén gedeeld woord is geen 'duidelijk' Standpunt, tenzij de Drijfveer zelf maar 1-2 inhoudswoorden heeft.
    if (shared >= (own.size <= 2 ? 1 : 2)) matches.push({ driveId: row.id, score: shared / Math.min(own.size, said.size) });
  }
  return matches;
}

/** Boos-delta (Type1-schaal, wordt door applyDeltas met reactiviteit geschaald) bij een Standpunt op een Ergernis. */
export const OPINION_BOOS_DELTA = 20;

/** De korte Nederlandse systeemregel voor Type2 bij een Standpunt; null bij 'geen'. */
export function opinionPrompt(kind: OpinionKind, drive: Pick<DriveRow, "kind" | "text">): string | null {
  const raakt = `Dit raakt aan je ${DRIVE_LABELS[drive.kind]} "${drive.text}"`;
  if (kind === "tegenspraak") return `${raakt}: zeg dat eerlijk en respectvol, in jouw karakter. Spreek de ander gerust tegen als je het er niet mee eens bent.`;
  if (kind === "saai") return `${raakt}: je vindt dit onderwerp saai of niet je ding. Zeg dat eerlijk en respectvol, in jouw karakter, zonder de ander af te kappen.`;
  if (kind === "voorkeur") return `${raakt}: laat je enthousiasme merken en zeg eerlijk wat je ervan vindt, in jouw karakter.`;
  return null;
}
