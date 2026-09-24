import { describe, expect, it } from "vitest";
import { voiceReaction } from "./voice-reaction.js";

const rep = (v: number, n: number) => Array<number>(n).fill(v);
const react = (samples: number[], baseline = 0) => voiceReaction({ samples, baseline });

describe("voiceReaction", () => {
  it("schrikt bij een plotselinge harde stijging", () => {
    expect(react([...rep(0.05, 15), 0.6]).startle).toBeGreaterThan(0.5);
  });

  it("de schrik neemt binnen ~400ms af", () => {
    const base = rep(0.05, 15);
    expect(react([...base, 0.6, 0.6]).startle).toBeLessThan(react([...base, 0.6]).startle);
    expect(react([...base, 0.6, 0.6, 0.6, 0.6, 0.6]).startle).toBe(0);
  });

  it("geen schrik bij gestaag hard praten of bij een kleine sprong onder de drempel", () => {
    expect(react(rep(0.5, 16)).startle).toBe(0);
    expect(react([...rep(0.02, 15), 0.2]).startle).toBe(0);
  });

  it("leunt naar voren bij aanhoudend fluisteren", () => {
    expect(react(rep(0.06, 20)).lean).toBeGreaterThan(0.5);
  });

  it("leunt niet bij stilte of normaal spreken", () => {
    expect(react(rep(0, 20))).toEqual({ startle: 0, lean: 0, alert: 0 });
    expect(react(rep(0.3, 20)).lean).toBe(0);
  });

  it("is alert bij veel pieken in korte tijd (snel praten)", () => {
    const fast = [0.1, 0.35, 0.1, 0.4, 0.1, 0.35, 0.1, 0.4, 0.1, 0.35];
    expect(react([...rep(0.1, 10), ...fast]).alert).toBeGreaterThan(0.5);
  });

  it("is niet alert bij gelijkmatig volume of één piek", () => {
    expect(react(rep(0.2, 20)).alert).toBe(0);
    expect(react([...rep(0.1, 12), 0.4, ...rep(0.1, 7)]).alert).toBe(0);
  });

  it("baseline (ruisvloer) wordt eraf getrokken", () => {
    expect(react(rep(0.06, 20), 0.06)).toEqual({ startle: 0, lean: 0, alert: 0 });
  });
});
