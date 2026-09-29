import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dynimos, familiarities, persons } from "@animus/db/schema";
import { createTestDb, truncateAll } from "./db.js";

const db = createTestDb();
beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await db.$client.end();
});

const base = { name: "Vero", coreCharacter: "Rustig.", birthStory: "Geboren.", seed: "z", bornAt: new Date("2026-01-01T12:00:00.000Z") };

describe("familiarities.familiarity", () => {
  it("weigert waarden buiten 0–1", async () => {
    const [dynimo] = await db.insert(dynimos).values(base).returning();
    const [person] = await db.insert(persons).values({ name: "Anna" }).returning();
    await expect(db.insert(familiarities).values({ dynimoId: dynimo!.id, personId: person!.id, familiarity: 1.5 })).rejects.toThrow();
  });
});
