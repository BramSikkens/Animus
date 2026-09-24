import { describe, expect, it } from "vitest";
import { CLIPS_PER_KIND, clipUrl } from "./sound.js";

describe("clipUrl", () => {
  it("kiest een clip uit de set van de triggersoort via de random-functie", () => {
    expect(clipUrl("kirren", () => 0)).toBe("/sounds/kirren-1.wav");
    expect(clipUrl("zuchten", () => 0.999)).toBe(`/sounds/zuchten-${CLIPS_PER_KIND}.wav`);
    expect(clipUrl("brommen", () => 0.5)).toBe("/sounds/brommen-2.wav");
  });
});
