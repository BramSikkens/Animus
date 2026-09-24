import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dynimos } from "@animus/db/schema";
import { createTestDb, truncateAll } from "./db.js";

const db = createTestDb();
beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$client.end();
});

const base = { name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt: new Date("2026-01-01T12:00:00.000Z") };

describe("dynimos.familiarity", () => {
  it("start op 0.2", async () => {
    const [row] = await db.insert(dynimos).values(base).returning();
    expect(row!.familiarity).toBe(0.2);
  });

  it("weigert waarden buiten 0–1", async () => {
    await expect(db.insert(dynimos).values({ ...base, familiarity: 1.5 })).rejects.toThrow();
  });
});
