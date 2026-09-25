import { describe, expect, it, vi } from "vitest";
import { createCommandHandler, galleryMessageFor } from "./gallery-commands.js";

const rows = [
  { id: 1, name: "Anna", awakeSince: null },
  { id: 2, name: "Bo", awakeSince: new Date() },
];

function setup(list = rows) {
  const brain = { list: vi.fn(async () => list), wake: vi.fn(async () => null), sleep: vi.fn(async () => {}) };
  const publishGallery = vi.fn();
  const handle = createCommandHandler({ brain, publishGallery, onError: () => {} });
  return { brain, publishGallery, handle };
}

describe("galleryMessageFor", () => {
  it("geeft id, naam en of de Dynimo wakker is", () => {
    expect(galleryMessageFor(rows, [])).toEqual({
      beings: [
        { id: 1, name: "Anna", awake: false },
        { id: 2, name: "Bo", awake: true },
      ],
      graves: [],
    });
  });

  it("zet Grafschriften om naar graven met ISO-datums en de Afscheidsreflectie als farewell", () => {
    const epitaph = { id: 7, name: "Cor", bornAt: new Date("2026-01-01T00:00:00.000Z"), deletedAt: new Date("2026-03-01T00:00:00.000Z"), farewellReflection: "Tot ziens." };
    expect(galleryMessageFor([], [epitaph]).graves).toEqual([
      { id: 7, name: "Cor", bornAt: "2026-01-01T00:00:00.000Z", deletedAt: "2026-03-01T00:00:00.000Z", farewell: "Tot ziens." },
    ]);
  });

  it("houdt hooguit de eerste 50 graven (invoer is nieuwste eerst)", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: i, name: "x", bornAt: new Date(0), deletedAt: new Date(0), farewellReflection: "" }));
    const graves = galleryMessageFor([], many).graves;
    expect(graves).toHaveLength(50);
    expect(graves[0]!.id).toBe(0);
  });
});

describe("createCommandHandler", () => {
  it("wekt bij een geldig wake-commando en publiceert daarna de Galerij", async () => {
    const { brain, publishGallery, handle } = setup();
    await handle({ type: "wake", id: 1 });
    expect(brain.wake).toHaveBeenCalledWith(1);
    expect(publishGallery).toHaveBeenCalledTimes(1);
  });

  it("laat de wakkere Dynimo slapen bij sleep met zijn id", async () => {
    const { brain, publishGallery, handle } = setup();
    await handle({ type: "sleep", id: 2 });
    expect(brain.sleep).toHaveBeenCalledTimes(1);
    expect(publishGallery).toHaveBeenCalledTimes(1);
  });

  it("negeert sleep voor een Dynimo die niet wakker is (een verlopen Terug mag een andere niet slapen leggen)", async () => {
    const { brain, handle } = setup();
    await handle({ type: "sleep", id: 1 });
    expect(brain.sleep).not.toHaveBeenCalled();
  });

  it("doet niets bij ongeldige commando's", async () => {
    const { brain, publishGallery, handle } = setup();
    for (const bad of [null, "wake", { type: "kill", id: 1 }, { type: "wake", id: "1" }, { type: "wake", id: 1.5 }]) await handle(bad);
    expect(brain.wake).not.toHaveBeenCalled();
    expect(brain.sleep).not.toHaveBeenCalled();
    expect(publishGallery).not.toHaveBeenCalled();
  });

  it("gooit niet als het brein faalt, maar meldt de fout", async () => {
    const { brain } = setup();
    brain.wake.mockRejectedValue(new Error("db weg"));
    const onError = vi.fn();
    const handle = createCommandHandler({ brain, publishGallery: () => {}, onError });
    await expect(handle({ type: "wake", id: 1 })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});
