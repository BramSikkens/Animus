import { describe, expect, it, vi } from "vitest";
import { routeNotifyPayload } from "./dynimo-watch.js";

describe("routeNotifyPayload", () => {
  it("routeert \"kenmerken:<id>\" naar onKenmerken, zonder check() of onNotify (zoals mood:)", () => {
    const check = vi.fn();
    const onNotify = vi.fn();
    const onKenmerken = vi.fn();
    routeNotifyPayload("kenmerken:3", { check, onNotify, onKenmerken });
    expect(onKenmerken).toHaveBeenCalledOnce();
    expect(onNotify).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it("routeert \"mood:<id>\" naar onMood, zonder check() of onNotify", () => {
    const check = vi.fn();
    const onNotify = vi.fn();
    const onMood = vi.fn();
    routeNotifyPayload("mood:3", { check, onNotify, onMood });
    expect(onMood).toHaveBeenCalledOnce();
    expect(onNotify).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it("routeert \"voice:<id>\" naar onVoice, mét onNotify (ongewijzigd gedrag)", () => {
    const check = vi.fn();
    const onNotify = vi.fn();
    const onVoice = vi.fn();
    routeNotifyPayload("voice:3", { check, onNotify, onVoice });
    expect(onVoice).toHaveBeenCalledOnce();
    expect(onNotify).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
  });

  it("valt terug op check() voor elke andere melding", () => {
    const check = vi.fn();
    const onNotify = vi.fn();
    routeNotifyPayload("3", { check, onNotify });
    expect(check).toHaveBeenCalledOnce();
    expect(onNotify).toHaveBeenCalledOnce();
  });
});
