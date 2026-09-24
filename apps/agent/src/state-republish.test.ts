import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStateRepublisher, emotionMessageFor } from "./state-republish.js";

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
    expect(emotionMessageFor(null)).toEqual({ emotion: "neutraal", intensity: 0 });
  });
});
