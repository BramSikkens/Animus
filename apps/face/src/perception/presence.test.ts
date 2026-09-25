import { describe, expect, it } from "vitest";
import { createPresence } from "./presence.js";

describe("createPresence", () => {
  it("meldt niets zolang de toestand nog geen debounceMs stabiel is", () => {
    const presence = createPresence({ debounceMs: 1500 });
    expect(presence.update(true, 0)).toBeNull();
    expect(presence.update(true, 1000)).toBeNull();
  });

  it("meldt de eerste toestand zodra die debounceMs stabiel is, ook afwezig", () => {
    const presence = createPresence({ debounceMs: 1500 });
    presence.update(false, 0);
    expect(presence.update(false, 1500)).toBe("afwezig");
  });

  it("meldt dezelfde stabiele toestand niet opnieuw", () => {
    const presence = createPresence({ debounceMs: 1500 });
    presence.update(true, 0);
    expect(presence.update(true, 1500)).toBe("aanwezig");
    expect(presence.update(true, 3000)).toBeNull();
  });

  it("negeert flikkeren korter dan debounceMs", () => {
    const presence = createPresence({ debounceMs: 1500 });
    presence.update(true, 0);
    presence.update(false, 500); // flikker, resetten de candidate-klok
    expect(presence.update(false, 1500)).toBeNull(); // pas 1000ms sinds de flikker
    expect(presence.update(false, 2000)).toBe("afwezig");
  });

  it("meldt een echte wissel na debounceMs opnieuw", () => {
    const presence = createPresence({ debounceMs: 1500 });
    presence.update(true, 0);
    expect(presence.update(true, 1500)).toBe("aanwezig");
    presence.update(false, 2000);
    expect(presence.update(false, 3499)).toBeNull();
    expect(presence.update(false, 3500)).toBe("afwezig");
  });
});
