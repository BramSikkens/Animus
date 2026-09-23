// Browser-veilig: geen node-imports. Brein en dashboard delen dit.
export const DRIVE_KINDS = ["wens", "doel", "toekomstdroom", "afkeer", "ergernis"] as const;
export type DriveKind = (typeof DRIVE_KINDS)[number];

export const DRIVE_LABELS: Record<DriveKind, string> = {
  wens: "Wens",
  doel: "Doel",
  toekomstdroom: "Toekomstdroom",
  afkeer: "Afkeer",
  ergernis: "Ergernis",
};

export const GOAL_STATUSES = ["actief", "bereikt", "opgegeven"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Uitleg van de vijf soorten, voor de genesis- en backfill-prompts. */
export const DRIVE_DESCRIPTIONS = `wens: iets wat je graag zou willen (zacht, zonder plan);
doel: iets concreets waar je actief naartoe werkt en dat je kunt bereiken of loslaten;
toekomstdroom: een groot, verre beeld van wat je ooit zou willen zijn of meemaken;
afkeer: iets waar je een diepe weerzin tegen voelt (met sterkte 0 tot 1);
ergernis: iets kleins dat je snel irriteert (met sterkte 0 tot 1).`;

export type DriveRow = {
  id: number;
  kind: DriveKind;
  text: string;
  /** Enkel Doelen. */
  status: GoalStatus | null;
  /** Enkel Afkeer en Ergernis, 0..1. */
  strength: number | null;
};

export function strengthWord(strength: number): "mild" | "sterk" {
  return strength >= 0.5 ? "sterk" : "mild";
}

/** Het promptblok met de actieve Drijfveren; leeg als er geen zijn. Deterministisch (byte-stabiel voor het cachepunt). */
export function drivesPromptBlock(rows: readonly DriveRow[]): string {
  const sections: string[] = [];
  for (const kind of DRIVE_KINDS) {
    const active = rows
      .filter((row) => row.kind === kind && (kind !== "doel" || row.status === "actief"))
      .sort((a, b) => a.id - b.id);
    if (active.length === 0) continue;
    const lines = active.map((row) => `- ${row.text}${row.strength === null ? "" : ` (${strengthWord(row.strength)})`}`);
    sections.push(`${DRIVE_LABELS[kind]}:\n${lines.join("\n")}`);
  }
  if (sections.length === 0) return "";
  return `Wat je wilt en niet wilt (vertel er gerust over als het past, maar forceer het niet):\n${sections.join("\n")}`;
}
