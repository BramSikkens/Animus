import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStateRepublisher, emotionMessageFor, withFaceExpressiveness } from "./state-republish.js";

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
