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
    expect(galleryMessageFor(rows)).toEqual({
      beings: [
        { id: 1, name: "Anna", awake: false },
        { id: 2, name: "Bo", awake: true },
      ],
    });
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
