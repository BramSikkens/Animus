import { describe, expect, it } from "vitest";
import { DRIVE_KINDS, DRIVE_LABELS, drivesPromptBlock, isActiveDrive, type DriveRow } from "../src/drives.js";

const drive = (id: number, kind: DriveRow["kind"], text: string, extra: Partial<DriveRow> = {}): DriveRow => ({
  id,
  kind,
  text,
  status: kind === "doel" ? "actief" : null,
  ...extra,
});

describe("drives", () => {
  it("kent de vier soorten in vaste volgorde met Nederlandse labels", () => {
    expect(DRIVE_KINDS).toEqual(["wens", "doel", "toekomstdroom", "ergernis"]);
    expect(DRIVE_KINDS.map((kind) => DRIVE_LABELS[kind])).toEqual(["Wens", "Doel", "Toekomstdroom", "Ergernis"]);
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

  it("laat gedropte Drijfveren weg uit het blok (zachte verwijdering)", () => {
    const dropped = new Date("2026-01-01T00:00:00.000Z");
    const rows = [drive(1, "wens", "Gedropte wens", { droppedAt: dropped }), drive(2, "ergernis", "Gedropte ergernis", { droppedAt: dropped })];
    expect(drivesPromptBlock(rows)).toBe("");
    const block = drivesPromptBlock([...rows, drive(3, "wens", "Levende wens")]);
    expect(block).toContain("Levende wens");
    expect(block).not.toContain("Gedropte");
  });

  it("kent een actieve Drijfveer: niet gedropt, en bij een Doel status actief", () => {
    expect(isActiveDrive(drive(1, "wens", "a"))).toBe(true);
    expect(isActiveDrive(drive(2, "wens", "a", { droppedAt: new Date() }))).toBe(false);
    expect(isActiveDrive(drive(3, "doel", "a", { status: "bereikt" }))).toBe(false);
    expect(isActiveDrive(drive(4, "doel", "a"))).toBe(true);
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
    const rows = [drive(1, "wens", "A"), drive(2, "ergernis", "B"), drive(3, "wens", "C")];
    expect(drivesPromptBlock([...rows].reverse())).toBe(drivesPromptBlock(rows));
  });

  it("noemt geen sterkte bij een Ergernis", () => {
    const block = drivesPromptBlock([drive(1, "ergernis", "Kou")]);
    expect(block).toContain("- Kou");
    expect(block).not.toContain("(mild)");
    expect(block).not.toContain("(sterk)");
  });
});
