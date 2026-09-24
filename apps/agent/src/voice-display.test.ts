import { describe, expect, it } from "vitest";
import { resolveDisplay, voiceDisplay } from "./voice-display.js";

describe("voiceDisplay", () => {
  it("agent speaking geeft spreekt", () => {
    expect(voiceDisplay("speaking", "listening")).toBe("spreekt");
  });
  it("agent speaking wint van user speaking (overlap)", () => {
    expect(voiceDisplay("speaking", "speaking")).toBe("spreekt");
  });
  it("user speaking geeft luisterend", () => {
    expect(voiceDisplay("listening", "speaking")).toBe("luisterend");
  });
  it("de rest (thinking, idle, away) is wakker", () => {
    expect(voiceDisplay("thinking", "listening")).toBe("wakker");
    expect(voiceDisplay("idle", "away")).toBe("wakker");
  });
});

describe("resolveDisplay", () => {
  it("slapend en reflecterend winnen van de LiveKit-toestand", () => {
    expect(resolveDisplay("slapend", "spreekt")).toBe("slapend");
    expect(resolveDisplay("reflecterend", "luisterend")).toBe("reflecterend");
  });
  it("wakker laat de LiveKit-toestand door", () => {
    expect(resolveDisplay("wakker", "spreekt")).toBe("spreekt");
    expect(resolveDisplay("wakker", "wakker")).toBe("wakker");
  });
});
