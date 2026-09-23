import { describe, expect, it } from "vitest";
import { DRIVE_KINDS, DRIVE_LABELS, drivesPromptBlock, strengthWord, type DriveRow } from "../src/drives.js";

const drive = (id: number, kind: DriveRow["kind"], text: string, extra: Partial<DriveRow> = {}): DriveRow => ({
  id,
  kind,
  text,
  status: kind === "doel" ? "actief" : null,
  strength: kind === "afkeer" || kind === "ergernis" ? 0.5 : null,
  ...extra,
});

describe("drives", () => {
  it("kent de vijf soorten in vaste volgorde met Nederlandse labels", () => {
    expect(DRIVE_KINDS).toEqual(["wens", "doel", "toekomstdroom", "afkeer", "ergernis"]);
    expect(DRIVE_KINDS.map((kind) => DRIVE_LABELS[kind])).toEqual(["Wens", "Doel", "Toekomstdroom", "Afkeer", "Ergernis"]);
  });

  it("geeft geen blok zonder Drijfveren", () => {
    expect(drivesPromptBlock([])).toBe("");
  });

  it("laat bereikte en opgegeven Doelen weg, en geeft geen blok als er niets actiefs overblijft", () => {
    const rows = [drive(1, "doel", "Oud doel", { status: "bereikt" }), drive(2, "doel", "Laat los", { status: "opgegeven" })];
    expect(drivesPromptBlock(rows)).toBe("");
    const block = drivesPromptBlock([...rows, drive(3, "doel", "Nieuw doel")]);
    expect(block).toContain("Nieuw doel");
    expect(block).not.toContain("Oud doel");
    expect(block).not.toContain("Laat los");
  });

  it("groepeert per soort in vaste volgorde en binnen een soort op id", () => {
    const block = drivesPromptBlock([
      drive(5, "ergernis", "Lawaai"),
      drive(4, "wens", "Tweede wens"),
      drive(2, "toekomstdroom", "Een droom"),
      drive(1, "wens", "Eerste wens"),
      drive(3, "doel", "Een doel"),
    ]);
    const order = ["Eerste wens", "Tweede wens", "Een doel", "Een droom", "Lawaai"].map((text) => block.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(block).toContain("Wens:");
    expect(block).toContain("Ergernis:");
  });

  it("is byte-stabiel voor dezelfde invoer, ongeacht de volgorde van de rijen", () => {
    const rows = [drive(1, "wens", "A"), drive(2, "afkeer", "B"), drive(3, "wens", "C")];
    expect(drivesPromptBlock([...rows].reverse())).toBe(drivesPromptBlock(rows));
  });

  it("noemt de sterkte van Afkeer en Ergernis in woorden", () => {
    expect(strengthWord(0.49)).toBe("mild");
    expect(strengthWord(0.5)).toBe("sterk");
    const block = drivesPromptBlock([
      drive(1, "afkeer", "Kou", { strength: 0.9 }),
      drive(2, "ergernis", "Gedoe", { strength: 0.1 }),
    ]);
    expect(block).toContain("Kou (sterk)");
    expect(block).toContain("Gedoe (mild)");
  });
});
