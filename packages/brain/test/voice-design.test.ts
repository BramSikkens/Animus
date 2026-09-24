import { describe, expect, it } from "vitest";
import { cloneVoice, designVoice, saveDesignedVoice } from "../src/voice-design.js";

const TEXT = "Dit is een Nederlandse voorbeeldtekst voor de stem. ".repeat(3);

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("designVoice", () => {
  it("post beschrijving + tekst en geeft previews terug", async () => {
    const { fn, calls } = fakeFetch(200, {
      previews: [
        { generated_voice_id: "g1", audio_base_64: "AAA", media_type: "audio/mpeg" },
        { generated_voice_id: "g2", audio_base_64: "BBB", media_type: "audio/mpeg" },
      ],
      text: TEXT,
    });
    const previews = await designVoice(fn, "sleutel", "warme oude dame", TEXT);
    expect(previews).toEqual([
      { generatedVoiceId: "g1", audioBase64: "AAA", mediaType: "audio/mpeg" },
      { generatedVoiceId: "g2", audioBase64: "BBB", mediaType: "audio/mpeg" },
    ]);
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-voice/design");
    expect((calls[0]!.init.headers as Record<string, string>)["xi-api-key"]).toBe("sleutel");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      voice_description: "warme oude dame",
      text: TEXT,
      model_id: "eleven_multilingual_ttv_v2",
    });
  });

  it("weigert zonder key, zonder beschrijving en met te korte/lange tekst, zonder te fetchen", async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(designVoice(fn, "", "oude dame", TEXT)).rejects.toThrow(/ELEVENLABS_API_KEY/);
    await expect(designVoice(fn, "k", "  ", TEXT)).rejects.toThrow(/beschrijving/);
    await expect(designVoice(fn, "k", "oude dame", "te kort")).rejects.toThrow(/100 en 1000/);
    await expect(designVoice(fn, "k", "oude dame", "x".repeat(1001))).rejects.toThrow(/100 en 1000/);
    expect(calls).toHaveLength(0);
  });

  it("vertaalt API-fouten naar leesbare meldingen zonder de key te lekken", async () => {
    for (const [status, re] of [[401, /key/i], [402, /limiet|tegoed/i], [429, /limiet|tegoed/i], [422, /ongeldig|geweigerd/i], [500, /status 500/]] as const) {
      const { fn } = fakeFetch(status, { detail: "x" });
      const error = await designVoice(fn, "geheim", "oude dame", TEXT).catch((e: Error) => e);
      expect((error as Error).message).toMatch(re);
      expect((error as Error).message).not.toContain("geheim");
    }
  });
});

describe("saveDesignedVoice", () => {
  it("slaat een preview op en geeft het voice_id terug", async () => {
    const { fn, calls } = fakeFetch(200, { voice_id: "v9", name: "Oma" });
    const id = await saveDesignedVoice(fn, "sleutel", { name: "Oma", description: "warme oude dame", generatedVoiceId: "g1" });
    expect(id).toBe("v9");
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-voice");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ voice_name: "Oma", voice_description: "warme oude dame", generated_voice_id: "g1" });
  });

  it("weigert zonder key/naam/id en meldt API-fouten", async () => {
    const ok = fakeFetch(200, { voice_id: "v9" });
    await expect(saveDesignedVoice(ok.fn, "", { name: "a", description: "b", generatedVoiceId: "g" })).rejects.toThrow(/ELEVENLABS_API_KEY/);
    await expect(saveDesignedVoice(ok.fn, "k", { name: " ", description: "b", generatedVoiceId: "g" })).rejects.toThrow(/naam/);
    await expect(saveDesignedVoice(ok.fn, "k", { name: "a", description: "b", generatedVoiceId: "" })).rejects.toThrow(/preview/);
    expect(ok.calls).toHaveLength(0);
    const bad = fakeFetch(429, {});
    await expect(saveDesignedVoice(bad.fn, "k", { name: "a", description: "b", generatedVoiceId: "g" })).rejects.toThrow(/limiet/i);
  });
});

describe("cloneVoice", () => {
  const audio = (name = "a.mp3", type = "audio/mpeg", size = 10) => new File([new Uint8Array(size)], name, { type });

  it("stuurt multipart met naam en bestanden en geeft het voice_id terug", async () => {
    const { fn, calls } = fakeFetch(200, { voice_id: "c1", requires_verification: false });
    const id = await cloneVoice(fn, "sleutel", { name: "Eigen stem", files: [audio()], consent: true });
    expect(id).toBe("c1");
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/voices/add");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("name")).toBe("Eigen stem");
    expect(form.getAll("files")).toHaveLength(1);
    expect((calls[0]!.init.headers as Record<string, string>)["xi-api-key"]).toBe("sleutel");
  });

  it("weigert zonder toestemming, zonder bestanden, niet-audio, te groot, zonder naam of key", async () => {
    const { fn, calls } = fakeFetch(200, { voice_id: "c1" });
    const base = { name: "n", files: [audio()], consent: true };
    await expect(cloneVoice(fn, "k", { ...base, consent: false })).rejects.toThrow(/recht/);
    await expect(cloneVoice(fn, "k", { ...base, files: [] })).rejects.toThrow(/opname/);
    await expect(cloneVoice(fn, "k", { ...base, files: [audio("a.txt", "text/plain")] })).rejects.toThrow(/audio/);
    await expect(cloneVoice(fn, "k", { ...base, files: [audio("a.mp3", "audio/mpeg", 10 * 1024 * 1024 + 1)] })).rejects.toThrow(/10 MB/);
    await expect(cloneVoice(fn, "k", { ...base, name: " " })).rejects.toThrow(/naam/);
    await expect(cloneVoice(fn, "", base)).rejects.toThrow(/ELEVENLABS_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  it("meldt API-fouten", async () => {
    const { fn } = fakeFetch(401, {});
    await expect(cloneVoice(fn, "k", { name: "n", files: [audio()], consent: true })).rejects.toThrow(/key/i);
  });
});
