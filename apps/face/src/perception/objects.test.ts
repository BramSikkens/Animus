import { describe, expect, it } from "vitest";
import { createObjectTracker } from "./objects.js";

describe("createObjectTracker", () => {
  it("meldt een nieuwe klasse pas zodra ze stableMs onafgebroken in beeld is", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    expect(tracker.update([{ category: "cat", score: 0.9 }], 0)).toEqual([]);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 500)).toEqual([]);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 1000)).toEqual(["cat"]);
  });

  it("telt person nooit mee", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    expect(tracker.update([{ category: "person", score: 0.99 }], 0)).toEqual([]);
    expect(tracker.update([{ category: "person", score: 0.99 }], 2000)).toEqual([]);
  });

  it("negeert detecties onder minScore", () => {
    const tracker = createObjectTracker({ minScore: 0.6, stableMs: 1000, warmupMs: 0 });
    expect(tracker.update([{ category: "cat", score: 0.59 }], 0)).toEqual([]);
    expect(tracker.update([{ category: "cat", score: 0.59 }], 1000)).toEqual([]);
  });

  it("reset de teller zodra een klasse één frame wegvalt", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    tracker.update([{ category: "cat", score: 0.9 }], 0);
    tracker.update([], 500); // valt weg
    expect(tracker.update([{ category: "cat", score: 0.9 }], 1000)).toEqual([]); // teller is opnieuw begonnen bij 1000
    expect(tracker.update([{ category: "cat", score: 0.9 }], 2000)).toEqual(["cat"]);
  });

  it("markeert een klasse die al bij het wakker worden stabiel stond stil als gezien (warmup)", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 3000 });
    // eerste update-frame is t=0: warmup loopt tot t=3000.
    expect(tracker.update([{ category: "cat", score: 0.9 }], 0)).toEqual([]);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 1000)).toEqual([]); // stabiel, maar binnen warmup: stil

    // ook na de warmup wordt "cat" niet alsnog gemeld: eenmaal (stil) gezien is gezien.
    expect(tracker.update([{ category: "cat", score: 0.9 }], 4000)).toEqual([]);
  });

  it("meldt een klasse die pas ná de warmup stabiel wordt gewoon", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 3000 });
    tracker.update([], 0); // warmup begint bij dit eerste frame, ongeacht detecties
    expect(tracker.update([{ category: "cat", score: 0.9 }], 3000)).toEqual([]);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 4000)).toEqual(["cat"]);
  });

  it("meldt een eenmaal geziene klasse nooit opnieuw", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    tracker.update([{ category: "cat", score: 0.9 }], 0);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 1000)).toEqual(["cat"]);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 2000)).toEqual([]);
    tracker.update([], 2500);
    expect(tracker.update([{ category: "cat", score: 0.9 }], 4000)).toEqual([]);
  });

  it("normaliseert naar lowercase en slaat labels over die niet door isWaarneming komen", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    tracker.update([{ category: "Cat", score: 0.9 }], 0);
    expect(tracker.update([{ category: "Cat", score: 0.9 }], 1000)).toEqual(["cat"]);

    const invalid = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    invalid.update([{ category: "cat123", score: 0.9 }], 0);
    expect(invalid.update([{ category: "cat123", score: 0.9 }], 1000)).toEqual([]);
  });

  it("een nieuwe tracker ziet weer alles als nieuw", () => {
    const first = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    first.update([{ category: "cat", score: 0.9 }], 0);
    first.update([{ category: "cat", score: 0.9 }], 1000);

    const fresh = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    fresh.update([{ category: "cat", score: 0.9 }], 0);
    expect(fresh.update([{ category: "cat", score: 0.9 }], 1000)).toEqual(["cat"]);
  });

  it("meldt meerdere gelijktijdig stabiele klassen samen", () => {
    const tracker = createObjectTracker({ stableMs: 1000, warmupMs: 0 });
    tracker.update([{ category: "cat", score: 0.9 }, { category: "dog", score: 0.9 }], 0);
    expect(tracker.update([{ category: "cat", score: 0.9 }, { category: "dog", score: 0.9 }], 1000).sort()).toEqual(["cat", "dog"]);
  });
});
