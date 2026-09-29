import { describe, expect, it, vi } from "vitest";
import { createCommandHandler, galleryMessageFor } from "./gallery-commands.js";

const rows = [
  { id: 1, name: "Anna", awakeSince: null, bornAt: new Date("2026-01-01T00:00:00.000Z") },
  { id: 2, name: "Bo", awakeSince: new Date(), bornAt: new Date("2026-02-01T00:00:00.000Z") },
];

function setup(list = rows) {
  const animus = { list: vi.fn(async () => list), wake: vi.fn(async () => null), sleep: vi.fn(async () => {}), kill: vi.fn(async () => null), bringToLife: vi.fn(async () => ({})) };
  const publishGallery = vi.fn();
  const handle = createCommandHandler({ animus, publishGallery, onError: () => {} });
  return { animus, publishGallery, handle };
}

describe("galleryMessageFor", () => {
  it("geeft id, naam, of de Dynimo wakker is en zijn geboortedatum (ISO)", () => {
    expect(galleryMessageFor(rows, [])).toEqual({
      beings: [
        { id: 1, name: "Anna", awake: false, bornAt: "2026-01-01T00:00:00.000Z" },
        { id: 2, name: "Bo", awake: true, bornAt: "2026-02-01T00:00:00.000Z" },
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
    const { animus, publishGallery, handle } = setup();
    await handle({ type: "wake", id: 1 });
    expect(animus.wake).toHaveBeenCalledWith(1);
    expect(publishGallery).toHaveBeenCalledTimes(1);
  });

  it("laat de wakkere Dynimo slapen bij sleep met zijn id", async () => {
    const { animus, publishGallery, handle } = setup();
    await handle({ type: "sleep", id: 2 });
    expect(animus.sleep).toHaveBeenCalledTimes(1);
    expect(publishGallery).toHaveBeenCalledTimes(1);
  });

  it("negeert sleep voor een Dynimo die niet wakker is (een verlopen Terug mag een andere niet slapen leggen)", async () => {
    const { animus, handle } = setup();
    await handle({ type: "sleep", id: 1 });
    expect(animus.sleep).not.toHaveBeenCalled();
  });

  it("doodt bij kill met id en bevestigde naam en publiceert daarna de Galerij", async () => {
    const { animus, publishGallery, handle } = setup();
    await handle({ type: "kill", id: 1, name: "Anna" });
    expect(animus.kill).toHaveBeenCalledWith(1, "Anna");
    expect(publishGallery).toHaveBeenCalledTimes(1);
  });

  it("brengt een nieuwe Dynimo tot leven bij birth en publiceert daarna de Galerij", async () => {
    const { animus, publishGallery, handle } = setup();
    await handle({ type: "birth" });
    expect(animus.bringToLife).toHaveBeenCalledTimes(1);
    expect(publishGallery).toHaveBeenCalledTimes(1);
  });

  it("doet niets bij ongeldige commando's", async () => {
    const { animus, publishGallery, handle } = setup();
    for (const bad of [null, "wake", { type: "kill", id: 1 }, { type: "wake", id: "1" }, { type: "wake", id: 1.5 }, { type: "kill", id: 1, name: 3 }]) await handle(bad);
    expect(animus.kill).not.toHaveBeenCalled();
    expect(animus.wake).not.toHaveBeenCalled();
    expect(animus.sleep).not.toHaveBeenCalled();
    expect(publishGallery).not.toHaveBeenCalled();
  });

  it("gooit niet als de Animus faalt, maar meldt de fout", async () => {
    const { animus } = setup();
    animus.wake.mockRejectedValue(new Error("db weg"));
    const onError = vi.fn();
    const handle = createCommandHandler({ animus, publishGallery: () => {}, onError });
    await expect(handle({ type: "wake", id: 1 })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});
