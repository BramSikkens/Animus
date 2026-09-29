import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dynimo } from "@animus/core";
import { createStateRepublisher, emotionMessageFor, kenmerkenMessageFor, withFaceExpressiveness } from "./state-republish.js";

describe("createStateRepublisher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publiceert periodiek zolang isActive waar is", () => {
    const publish = vi.fn();
    const republisher = createStateRepublisher({ intervalMs: 5000, isActive: () => true, publish });
    republisher.start();
    vi.advanceTimersByTime(15_000);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("slaat een tik over als niet actief (slapend of geen face)", () => {
    const publish = vi.fn();
    createStateRepublisher({ intervalMs: 5000, isActive: () => false, publish }).start();
    vi.advanceTimersByTime(15_000);
    expect(publish).not.toHaveBeenCalled();
  });

  it("stopt na dispose", () => {
    const publish = vi.fn();
    const republisher = createStateRepublisher({ intervalMs: 5000, isActive: () => true, publish });
    republisher.start();
    republisher.dispose();
    vi.advanceTimersByTime(15_000);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("emotionMessageFor", () => {
  it("geeft de Stemming door", () => {
    const mood = { emotion: "blij", intensity: 0.5, values: {} } as never;
    expect(emotionMessageFor(mood)).toBe(mood);
  });

  it("geeft bij geen Stemming (slapend) een reset zonder values", () => {
    expect(emotionMessageFor(null)).toEqual({ emotion: "kalm", intensity: 0 });
  });
});

describe("withFaceExpressiveness", () => {
  const values = { blij: 80 } as never;

  it("schaalt enkel de intensiteit; emotion en values blijven gelijk", () => {
    const message = { emotion: "blij", intensity: 0.6, values } as const;
    const scaled = withFaceExpressiveness(message, 0);
    expect(scaled.intensity).toBeCloseTo(0.3);
    expect(scaled.emotion).toBe("blij");
    expect(scaled.values).toBe(values);
  });

  it("laat het bericht bij expressiviteit 0.5 gelijk", () => {
    expect(withFaceExpressiveness({ emotion: "blij", intensity: 0.6, values }, 0.5).intensity).toBeCloseTo(0.6);
  });

  it("laat de reset (geen Stemming) ongewijzigd", () => {
    expect(withFaceExpressiveness(emotionMessageFor(null), 1)).toEqual({ emotion: "kalm", intensity: 0 });
  });
});

describe("kenmerkenMessageFor", () => {
  const row = {
    archetype: "professor",
    baseEmotion: "nieuwsgierig",
    coreCharacter: "Rustig en nieuwsgierig.",
    axisIe: 0.2,
    axisSn: 0.8,
    axisTf: null,
    axisJp: 0.6,
    axisReactivity: 0.5,
    axisExpressiveness: 0.7,
    verstand: 0.9,
  } as Pick<Dynimo, "archetype" | "baseEmotion" | "coreCharacter" | "axisIe" | "axisSn" | "axisTf" | "axisJp" | "axisReactivity" | "axisExpressiveness" | "verstand">;

  it("geeft null zonder wakkere Dynimo, zodat het paneel verdwijnt", () => {
    expect(kenmerkenMessageFor(null, { onbekend: true })).toBeNull();
  });

  it("zet een Dynimo-rij en Vertrouwdheid om in een KenmerkenMessage", () => {
    expect(kenmerkenMessageFor(row, { naam: "Bram", waarde: 0.6 })).toEqual({
      archetype: "professor",
      basisemotie: "nieuwsgierig",
      assen: { ie: 0.2, sn: 0.8, tf: null, jp: 0.6, reactivity: 0.5, expressiveness: 0.7 },
      verstand: 0.9,
      kernkarakter: "Rustig en nieuwsgierig.",
      vertrouwdheid: { naam: "Bram", waarde: 0.6 },
    });
  });

  it("valt terug op de standaard Basisemotie als baseEmotion (nog) leeg is", () => {
    expect(kenmerkenMessageFor({ ...row, baseEmotion: null }, { onbekend: true })?.basisemotie).toBe("kalm");
  });
});
