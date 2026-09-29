import { describe, expect, it } from "vitest";
import { isEigenaar, livekitEnv } from "../src/security.js";

describe("isEigenaar", () => {
  it("herkent enkel identities met het eigenaar-prefix", () => {
    expect(isEigenaar("eigenaar-abc")).toBe(true);
    expect(isEigenaar("gast-abc")).toBe(false);
    expect(isEigenaar("")).toBe(false);
  });
});

describe("livekitEnv", () => {
  it("valt terug op localhost + devkey/secret zonder env", () => {
    expect(livekitEnv({})).toEqual({ url: "ws://localhost:7880", apiKey: "devkey", apiSecret: "secret" });
  });

  it("vult devkey/secret ook aan bij een expliciete lokale host", () => {
    expect(livekitEnv({ LIVEKIT_URL: "ws://127.0.0.1:7880" })).toEqual({ url: "ws://127.0.0.1:7880", apiKey: "devkey", apiSecret: "secret" });
  });

  it("gebruikt de opgegeven key/secret als die er zijn, ook lokaal", () => {
    expect(livekitEnv({ LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" })).toEqual({ url: "ws://localhost:7880", apiKey: "k", apiSecret: "s" });
  });

  it("gooit een duidelijke fout bij een niet-lokale host zonder key/secret", () => {
    expect(() => livekitEnv({ LIVEKIT_URL: "wss://mijn-livekit.example.com" })).toThrow(/LIVEKIT_API_KEY/);
  });

  it("accepteert een niet-lokale host mét key/secret", () => {
    expect(livekitEnv({ LIVEKIT_URL: "wss://mijn-livekit.example.com", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" })).toEqual({
      url: "wss://mijn-livekit.example.com",
      apiKey: "k",
      apiSecret: "s",
    });
  });
});
