import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSilenceTimer, DEFAULT_SILENCE_MINUTES, MAX_TIMER_MS, parseSilenceMinutes } from "./silence-timer.js";

describe("createSilenceTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("vuurt één keer na de drempel zonder reset", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });
    timer.arm();

    vi.advanceTimersByTime(999);
    expect(onSilence).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSilence).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onSilence).toHaveBeenCalledTimes(1); // niet dubbel zonder nieuwe arm
  });

  it("herstart de drempel bij een reset", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });
    timer.arm();

    vi.advanceTimersByTime(600);
    timer.reset();
    vi.advanceTimersByTime(600);
    expect(onSilence).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("laat een lopende timer met arm() ongemoeid", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });
    timer.arm();

    vi.advanceTimersByTime(600);
    timer.arm();
    vi.advanceTimersByTime(400);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("start na afvuren pas opnieuw bij een nieuwe arm of reset", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });
    timer.arm();
    vi.advanceTimersByTime(1000);

    timer.arm();
    vi.advanceTimersByTime(1000);
    expect(onSilence).toHaveBeenCalledTimes(2);
    timer.reset();
    vi.advanceTimersByTime(1000);
    expect(onSilence).toHaveBeenCalledTimes(3);
  });

  it("stopt na dispose en start dan niet meer", () => {
    const onSilence = vi.fn();
    const timer = createSilenceTimer({ thresholdMs: 1000, onSilence });
    timer.arm();
    vi.advanceTimersByTime(500);

    timer.dispose();
    timer.reset();
    timer.arm();
    vi.advanceTimersByTime(5000);
    expect(onSilence).not.toHaveBeenCalled();
  });
});

describe("parseSilenceMinutes", () => {
  it("valt zonder waarde (of een lege env-var) stil terug op de default van 30 minuten", () => {
    expect(DEFAULT_SILENCE_MINUTES).toBe(30);
    expect(parseSilenceMinutes(undefined)).toEqual({ ms: 30 * 60_000 });
    expect(parseSilenceMinutes("")).toEqual({ ms: 30 * 60_000 });
  });

  it("accepteert ook fractionele minuten", () => {
    expect(parseSilenceMinutes("0.1")).toEqual({ ms: 6000 });
    expect(parseSilenceMinutes("45")).toEqual({ ms: 45 * 60_000 });
  });

  it.each(["abc", "0", "-5", "NaN", "Infinity"])("valt bij ongeldige waarde %s terug op de default, met een waarschuwing", (value) => {
    const result = parseSilenceMinutes(value);
    expect(result.ms).toBe(30 * 60_000);
    expect(result.warning).toContain("REFLECT_SILENCE_MINUTES");
  });

  it("begrenst te grote waarden op de setTimeout-limiet, met een waarschuwing", () => {
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1);
    const result = parseSilenceMinutes("99999");
    expect(result.ms).toBe(MAX_TIMER_MS);
    expect(result.warning).toContain("REFLECT_SILENCE_MINUTES");
    expect(parseSilenceMinutes("35000").warning).toBeUndefined(); // net onder de limiet
  });
});
