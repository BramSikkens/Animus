import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitiativeTimer, DEFAULT_INITIATIVE_MINUTES, initiativeIntervalMs, parseInitiativeMinutes } from "./initiative-timer.js";

describe("initiativeIntervalMs", () => {
  it("is bij een neutrale N/P-kant gelijk aan de basis", () => {
    expect(initiativeIntervalMs({ sn: 0.5, jp: 0.5 }, 60_000)).toBeCloseTo(60_000);
  });

  it("is korter bij sterk N/P en langer bij sterk S/J", () => {
    const np = initiativeIntervalMs({ sn: 1, jp: 1 }, 60_000);
    const sj = initiativeIntervalMs({ sn: 0, jp: 0 }, 60_000);
    expect(np).toBeCloseTo(30_000);
    expect(sj).toBeCloseTo(120_000);
  });

  it("middelt de twee assen (een INTJ zit tussen INTP en ISFJ)", () => {
    const intj = initiativeIntervalMs({ sn: 1, jp: 0 }, 60_000);
    expect(intj).toBeCloseTo(60_000);
  });

  it("valt zonder assen terug op de basis", () => {
    expect(initiativeIntervalMs(null, 60_000)).toBe(60_000);
  });
});

describe("createInitiativeTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (overrides: Partial<Parameters<typeof createInitiativeTimer>[0]> = {}) => {
    const options = { intervalMs: () => 1000, random: () => 0.5, isQuiet: () => true, onCheck: vi.fn(), ...overrides };
    return { timer: createInitiativeTimer(options), onCheck: options.onCheck };
  };

  it("checkt periodiek, met een interval van intervalMs x (0.5 + random)", async () => {
    const { timer, onCheck } = make({ random: () => 0.5 }); // factor 1
    timer.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(onCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onCheck).toHaveBeenCalledTimes(2);
  });

  it("spreidt de wachttijd met random (0 = halve, 1 = anderhalve interval)", () => {
    const early = make({ random: () => 0 });
    early.timer.start();
    vi.advanceTimersByTime(500);
    expect(early.onCheck).toHaveBeenCalledTimes(1);
    early.timer.dispose();

    const late = make({ random: () => 1 });
    late.timer.start();
    vi.advanceTimersByTime(1499);
    expect(late.onCheck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(late.onCheck).toHaveBeenCalledTimes(1);
  });

  it("slaat de check over als het niet stil is, en probeert het bij de volgende ronde weer", () => {
    let quiet = false;
    const { timer, onCheck } = make({ isQuiet: () => quiet });
    timer.start();
    vi.advanceTimersByTime(1000);
    expect(onCheck).not.toHaveBeenCalled();
    quiet = true;
    vi.advanceTimersByTime(1000);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("plant de volgende ronde pas als een trage check klaar is (geen overlap)", async () => {
    let finish!: () => void;
    const { timer, onCheck } = make({ onCheck: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) });
    timer.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onCheck).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onCheck).toHaveBeenCalledTimes(2);
  });

  it("gaat door na een falende check", async () => {
    const onCheck = vi.fn().mockRejectedValueOnce(new Error("stuk")).mockResolvedValue(undefined);
    const { timer } = make({ onCheck });
    timer.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onCheck).toHaveBeenCalledTimes(2);
  });

  it("herstart de wachttijd bij een reset (bv. na een uiting)", () => {
    const { timer, onCheck } = make();
    timer.start();
    vi.advanceTimersByTime(600);
    timer.reset();
    vi.advanceTimersByTime(600);
    expect(onCheck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("begrenst de wachttijd op wat setTimeout aankan", () => {
    const { timer, onCheck } = make({ intervalMs: () => 2 ** 40 });
    timer.start();
    vi.advanceTimersByTime(2 ** 31 - 1);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("stopt na dispose", () => {
    const { timer, onCheck } = make();
    timer.start();
    timer.dispose();
    timer.reset();
    timer.start();
    vi.advanceTimersByTime(10_000);
    expect(onCheck).not.toHaveBeenCalled();
  });
});

describe("parseInitiativeMinutes", () => {
  it("valt zonder of met een lege waarde stil terug op de default", () => {
    expect(parseInitiativeMinutes(undefined)).toEqual({ ms: DEFAULT_INITIATIVE_MINUTES * 60_000 });
    expect(parseInitiativeMinutes("")).toEqual({ ms: DEFAULT_INITIATIVE_MINUTES * 60_000 });
  });

  it("accepteert (fractionele) minuten", () => {
    expect(parseInitiativeMinutes("0.5")).toEqual({ ms: 30_000 });
  });

  it("waarschuwt en valt terug bij een ongeldige waarde", () => {
    for (const bad of ["abc", "0", "-3"]) {
      const result = parseInitiativeMinutes(bad);
      expect(result.ms).toBe(DEFAULT_INITIATIVE_MINUTES * 60_000);
      expect(result.warning).toContain("INITIATIVE_CHECK_MINUTES");
    }
  });
});
