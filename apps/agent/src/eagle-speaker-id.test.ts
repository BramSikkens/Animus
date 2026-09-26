import { describe, expect, it, vi } from "vitest";

// Native Eagle vervangen: een profiler die nooit vordert, zodat de inschrijving na het maximum opgeeft.
vi.mock("@picovoice/eagle-node", () => ({
  Eagle: class {
    release(): void {}
  },
  EagleProfiler: class {
    frameLength = 1;
    enroll(): number {
      return 0;
    }
    flush(): number {
      return 0;
    }
    reset(): void {}
    release(): void {}
  },
}));

const { createEagleSpeakerId } = await import("./eagle-speaker-id.js");

describe("createEagleSpeakerId.enroll", () => {
  it("meldt 'opgegeven' (niet 'bezig') als de inschrijving na 10 beurten zonder voltooiing losgelaten wordt (#107)", async () => {
    const speakerId = createEagleSpeakerId({ accessKey: "x", threshold: 0.5, loadProfiles: async () => [], saveProfile: async () => {} });
    const statuses: string[] = [];
    for (let turn = 0; turn < 10; turn++) statuses.push(await speakerId.enroll(7, new Int16Array(4)));

    expect(statuses.slice(0, 9)).toEqual(new Array(9).fill("bezig"));
    expect(statuses[9]).toBe("opgegeven");
  });
});
