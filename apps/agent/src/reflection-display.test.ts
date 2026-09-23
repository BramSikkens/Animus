import { describe, expect, it, vi } from "vitest";
import { createReflectionDisplay } from "./reflection-display.js";

function setup(initialKey = "1:100") {
  let currentKey = initialKey;
  const publishDisplay = vi.fn();
  const publishState = vi.fn();
  const display = createReflectionDisplay({ getCurrentKey: () => currentKey, publishDisplay, publishState });
  return { display, publishDisplay, publishState, setKey: (key: string) => (currentKey = key) };
}

describe("createReflectionDisplay", () => {
  it("publiceert reflecterend bij het starten van een Reflectie op de huidige Dynimo", () => {
    const { display, publishDisplay } = setup();

    display.onStart("1:100");

    expect(publishDisplay).toHaveBeenCalledExactlyOnceWith("reflecterend");
  });

  it("publiceert niets en zet niets vast bij een verouderde sleutel", () => {
    const { display, publishDisplay, setKey } = setup();
    setKey("none"); // intussen is er niemand meer wakker

    display.onStart("1:100");

    expect(publishDisplay).not.toHaveBeenCalled();
    expect(display.displayFor("1:100", "wakker")).toBe("wakker");
    expect(display.displayFor("none", "slapend")).toBe("slapend");
  });

  it("zet bij een uiting tijdens de Reflectie het gezicht terug (wakker + Stemming) en publiceert bij afronding niet opnieuw", () => {
    const { display, publishDisplay, publishState } = setup();
    display.onStart("1:100");

    display.onUtterance();
    expect(publishState).toHaveBeenCalledTimes(1);
    expect(display.displayFor("1:100", "wakker")).toBe("wakker");

    display.onFinish("1:100");
    expect(publishState).toHaveBeenCalledTimes(1); // geen tweede publish
    expect(publishDisplay).toHaveBeenCalledTimes(1); // enkel het oorspronkelijke reflecterend
  });

  it("doet bij een uiting zonder lopende Reflectie niets", () => {
    const { display, publishState } = setup();
    display.onUtterance();
    expect(publishState).not.toHaveBeenCalled();
  });

  it("zet bij afronding het gezicht terug naar wakker + Stemming", () => {
    const { display, publishState } = setup();
    display.onStart("1:100");

    display.onFinish("1:100");

    expect(publishState).toHaveBeenCalledTimes(1);
    expect(display.displayFor("1:100", "wakker")).toBe("wakker");
  });

  it("laat een verlopen Reflectie het gezicht van een andere of slapende Dynimo niet overschrijven", () => {
    const { display, publishState, setKey } = setup();
    display.onStart("1:100");

    setKey("2:200"); // andere Dynimo gewekt
    display.onSwitch();
    display.onFinish("1:100");

    expect(publishState).not.toHaveBeenCalled();
    expect(display.displayFor("2:200", "wakker")).toBe("wakker");
  });

  it("publiceert bij afronding niets als de sleutel niet meer de huidige is, ook zonder onSwitch", () => {
    const { display, publishState, setKey } = setup();
    display.onStart("1:100");
    setKey("none");

    display.onFinish("1:100");

    expect(publishState).not.toHaveBeenCalled();
    expect(display.displayFor("1:100", "slapend")).toBe("slapend");
  });

  it("toont een late joiner tijdens een lopende Reflectie op dezelfde sleutel reflecterend", () => {
    const { display } = setup();
    display.onStart("1:100");

    expect(display.displayFor("1:100", "wakker")).toBe("reflecterend");
    expect(display.displayFor("2:200", "wakker")).toBe("wakker");
  });

  it("laat een gooiende publish in onStart de Reflectie niet afbreken", () => {
    const publishDisplay = vi.fn(() => {
      throw new Error("room weg");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const display = createReflectionDisplay({ getCurrentKey: () => "1:100", publishDisplay, publishState: vi.fn() });

    expect(() => display.onStart("1:100")).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
