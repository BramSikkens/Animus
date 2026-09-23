import { describe, expect, it } from "vitest";
import { DISPLAY_STATES, isDisplayState } from "../src/display.js";

describe("display", () => {
  it("kent de drie weergavetoestanden", () => {
    expect(DISPLAY_STATES).toEqual(["wakker", "reflecterend", "slapend"]);
  });

  it("valideert waarden met isDisplayState", () => {
    for (const state of DISPLAY_STATES) expect(isDisplayState(state)).toBe(true);
    expect(isDisplayState("dromend")).toBe(false);
    expect(isDisplayState(undefined)).toBe(false);
  });
});
