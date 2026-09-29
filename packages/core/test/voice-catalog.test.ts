import { describe, expect, it } from "vitest";
import { cached, fetchCatalog, fetchTier, filterVoices, normalizeVoice, unusableVoiceError, FREE_TIER_MESSAGE, type CatalogVoice } from "../src/voice-catalog.js";

describe("normalizeVoice", () => {
  it("normaliseert een Voice Library-stem (shared-voices)", () => {
    expect(
      normalizeVoice({
        voice_id: "v1",
        name: "Sanne",
        gender: "female",
        age: "young",
        accent: "dutch",
        descriptive: "warm",
        use_case: "conversational",
        description: "Vriendelijke stem",
        language: "nl",
        preview_url: "https://x/p.mp3",
      }),
    ).toEqual({
      id: "v1",
      name: "Sanne",
      gender: "female",
      age: "young",
      accent: "dutch",
      description: "Vriendelijke stem",
      useCase: "conversational",
      language: "nl",
      previewUrl: "https://x/p.mp3",
      category: "",
      usableOnFree: false,
    });
  });

  it("markeert premade/eigen stemmen uit /v1/voices als bruikbaar op free; bibliotheekstemmen (library) niet", () => {
    for (const category of ["premade", "generated", "cloned", "professional"]) {
      expect(normalizeVoice({ voice_id: "a", name: "A", category })).toMatchObject({ category, usableOnFree: true });
    }
    expect(normalizeVoice({ voice_id: "a", name: "A", category: "famous" })).toMatchObject({ usableOnFree: false });
    expect(normalizeVoice({ voice_id: "a", name: "A", category: "professional" }, true)).toMatchObject({ category: "professional", usableOnFree: false });
  });

  it("normaliseert een eigen/premade stem (labels, verified_languages)", () => {
    const voice = normalizeVoice({
      voice_id: "v2",
      name: "Adam",
      description: null,
      preview_url: "https://x/a.mp3",
      labels: { gender: "male", age: "middle_aged", accent: "american", use_case: "narration", descriptive: "deep" },
      verified_languages: [{ language: "nl" }],
    });
    expect(voice).toMatchObject({ id: "v2", gender: "male", age: "middle_aged", useCase: "narration", language: "nl", description: "deep" });
  });

  it("onthoudt bij een bibliotheekstem de eigenaar (nodig om hem aan het account toe te voegen)", () => {
    expect(normalizeVoice({ voice_id: "s1", name: "Marianne", public_owner_id: "own1" }, true)).toMatchObject({ publicOwnerId: "own1" });
    expect(normalizeVoice({ voice_id: "s1", name: "Marianne", public_owner_id: "own1" })).not.toHaveProperty("publicOwnerId");
  });

  it("geeft null zonder id of naam, en lege strings voor ontbrekende velden", () => {
    expect(normalizeVoice({ name: "x" })).toBeNull();
    expect(normalizeVoice({ voice_id: "v3", name: "Zed" })).toEqual({
      id: "v3", name: "Zed", gender: "", age: "", accent: "", description: "", useCase: "", language: "", previewUrl: "", category: "", usableOnFree: false,
    });
  });
});

const v = (over: Partial<CatalogVoice>): CatalogVoice => ({
  id: "i", name: "n", gender: "", age: "", accent: "", description: "", useCase: "", language: "", previewUrl: "", category: "", usableOnFree: true, ...over,
});

describe("filterVoices", () => {
  const voices = [
    v({ id: "a", name: "Sanne", gender: "female", age: "young", language: "nl", description: "warme stem" }),
    v({ id: "b", name: "Bram", gender: "male", age: "old", language: "nl", description: "hese oude man" }),
    v({ id: "c", name: "Joe", gender: "male", language: "en" }),
    v({ id: "d", name: "Multi", gender: "female" }),
  ];
  const ids = (list: CatalogVoice[]) => list.map((x) => x.id);

  it("filtert op geslacht en leeftijd", () => {
    expect(ids(filterVoices(voices, { gender: "male" }))).toEqual(["b", "c"]);
    expect(ids(filterVoices(voices, { age: "old" }))).toEqual(["b"]);
  });

  it("zoekt hoofdletterongevoelig in naam, beschrijving en accent", () => {
    expect(ids(filterVoices(voices, { text: "OUDE" }))).toEqual(["b"]);
    expect(ids(filterVoices(voices, { text: "sanne" }))).toEqual(["a"]);
  });

  it("taal: exacte taal plus meertalige stemmen zonder taal; leeg = alles", () => {
    expect(ids(filterVoices(voices, { language: "nl" }))).toEqual(["a", "b", "d"]);
    expect(ids(filterVoices(voices, {}))).toEqual(["a", "b", "c", "d"]);
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchCatalog", () => {
  it("haalt eigen stemmen en gepagineerde Voice Library op, met key-header, ontdubbeld", async () => {
    const calls: { url: string; key: string | null }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, key: new Headers(init.headers).get("xi-api-key") });
      if (url.includes("/v1/voices")) return json({ voices: [{ voice_id: "own", name: "Own" }] });
      const page = new URL(url).searchParams.get("page");
      return page === "0"
        ? json({ voices: [{ voice_id: "s1", name: "S1", language: "nl" }, { voice_id: "own", name: "Own" }], has_more: true })
        : json({ voices: [{ voice_id: "s2", name: "S2", language: "nl" }], has_more: false });
    }) as unknown as typeof fetch;

    const voices = await fetchCatalog(fetchFn, "sleutel", "nl");
    expect(voices.map((x) => x.id)).toEqual(["own", "s1", "s2"]);
    expect(calls.every((c) => c.key === "sleutel")).toBe(true);
    expect(calls.filter((c) => c.url.includes("shared-voices")).every((c) => c.url.includes("language=nl"))).toBe(true);
  });

  it("gooit een fout zonder de key te lekken bij een niet-OK antwoord", async () => {
    const fetchFn = (async () => json({}, 401)) as unknown as typeof fetch;
    const error = await fetchCatalog(fetchFn, "geheim", "nl").catch((e: Error) => e);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain("geheim");
  });
});

describe("fetchTier", () => {
  it("leest tier uit /v1/user/subscription met key-header", async () => {
    let seen: { url: string; key: string | null } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, key: new Headers(init.headers).get("xi-api-key") };
      return json({ tier: "free", status: "active" });
    }) as unknown as typeof fetch;
    expect(await fetchTier(fetchFn, "sleutel")).toBe("free");
    expect(seen).toEqual({ url: "https://api.elevenlabs.io/v1/user/subscription", key: "sleutel" });
  });

  it("geeft lege string (onbekend) bij een fout of onbruikbaar antwoord", async () => {
    expect(await fetchTier((async () => json({}, 401)) as unknown as typeof fetch, "k")).toBe("");
    expect(await fetchTier((async () => { throw new Error("net"); }) as unknown as typeof fetch, "k")).toBe("");
    expect(await fetchTier((async () => json({ tier: 5 })) as unknown as typeof fetch, "k")).toBe("");
  });
});

describe("fetchCatalog op tier", () => {
  const fetchFn = (async (url: string) =>
    url.includes("/v1/voices")
      ? json({ voices: [{ voice_id: "p", name: "P", category: "premade" }] })
      : json({ voices: [{ voice_id: "s", name: "S", category: "professional" }], has_more: false })) as unknown as typeof fetch;

  it("free: alleen eigen/premade kiesbaar, bibliotheekstem niet", async () => {
    const voices = await fetchCatalog(fetchFn, "k", "nl", "free");
    expect(voices.map((x) => [x.id, x.usableOnFree])).toEqual([["p", true], ["s", false]]);
  });

  it("niet-free of onbekend: alles kiesbaar", async () => {
    for (const tier of ["starter", ""]) {
      expect((await fetchCatalog(fetchFn, "k", "nl", tier)).every((x) => x.usableOnFree)).toBe(true);
    }
  });
});

describe("unusableVoiceError", () => {
  const list = [v({ id: "p" }), v({ id: "s", usableOnFree: false })];
  it("weigert een niet-kiesbare catalogusstem met de gratis-tier-melding", () => {
    expect(unusableVoiceError(list, "s")).toBe(FREE_TIER_MESSAGE);
    expect(FREE_TIER_MESSAGE).toContain("Starter");
  });
  it("laat kiesbare of onbekende stemmen door", () => {
    expect(unusableVoiceError(list, "p")).toBeNull();
    expect(unusableVoiceError(list, "onbekend")).toBeNull();
  });
});

describe("cached", () => {
  it("hergebruikt het resultaat binnen de ttl en laadt daarna opnieuw", async () => {
    let now = 0;
    let loads = 0;
    const get = cached(async () => ++loads, 1000, () => now);
    expect(await get()).toBe(1);
    now = 999;
    expect(await get()).toBe(1);
    now = 1000;
    expect(await get()).toBe(2);
  });

  it("cachet een fout kort (30 s) en laadt daarna opnieuw", async () => {
    let now = 0;
    let calls = 0;
    const get = cached(async () => {
      if (++calls === 1) throw new Error("stuk");
      return "ok";
    }, 1000, () => now);
    await expect(get()).rejects.toThrow("stuk");
    now = 29_999;
    await expect(get()).rejects.toThrow("stuk");
    expect(calls).toBe(1);
    now = 30_000;
    expect(await get()).toBe("ok");
  });

  it("deelt een lopende load tussen gelijktijdige aanroepen", async () => {
    let loads = 0;
    const get = cached(async () => ++loads, 1000, () => 0);
    expect(await Promise.all([get(), get(), get()])).toEqual([1, 1, 1]);
  });
});
