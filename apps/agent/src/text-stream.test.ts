import { ReadableStream } from "node:stream/web";
import { describe, expect, it } from "vitest";
import type { AnimusEvent } from "@animus/core";
import { textStream } from "./text-stream.js";

const VALUES = { blij: 0, boos: 0, verrast: 0, kalm: 0, verveeld: 0, nieuwsgierig: 0, bang: 0, droevig: 0, vredig: 0, druk: 0 };

async function* gen(events: AnimusEvent[]): AsyncGenerator<AnimusEvent> {
  for (const event of events) yield event;
}

async function collect(stream: ReadableStream<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("textStream", () => {
  it("geeft alleen text-deltas door, in volgorde", async () => {
    const events: AnimusEvent[] = [
      { type: "text", delta: "Hallo" },
      { type: "text", delta: " daar" },
    ];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hallo", " daar"]);
  });

  it("slaat mood- en tool-*-events over", async () => {
    const events: AnimusEvent[] = [
      { type: "mood", emotion: "blij", intensity: 0.8, values: VALUES },
      { type: "text", delta: "Hoi" },
      { type: "tool-call", toolName: "huidige_tijd", input: {} },
      { type: "tool-result", toolName: "huidige_tijd", output: "12:00" },
      { type: "text", delta: "!" },
    ];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hoi", "!"]);
  });

  it("eindigt de stream netjes als de bron gooit, zonder de consumer te laten crashen", async () => {
    async function* throwing(): AsyncGenerator<AnimusEvent> {
      yield { type: "text", delta: "Voor de fout" };
      throw new Error("animus.hear() faalde");
    }
    const chunks = await collect(textStream(throwing()));
    expect(chunks).toEqual(["Voor de fout"]);
  });

  it("roept onMood aan met de emotie, intensiteit en de volledige vector", async () => {
    const events: AnimusEvent[] = [
      { type: "mood", emotion: "blij", intensity: 0.8, values: VALUES },
      { type: "text", delta: "Hoi" },
    ];
    const calls: unknown[] = [];
    await collect(textStream(gen(events), { onMood: (mood) => calls.push(mood) }));
    expect(calls).toEqual([{ emotion: "blij", intensity: 0.8, values: VALUES }]);
  });

  it("roept onMood aan vóór de eerste tekst gelezen kan worden", async () => {
    const events: AnimusEvent[] = [
      { type: "mood", emotion: "boos", intensity: 0.5, values: VALUES },
      { type: "text", delta: "Hoi" },
    ];
    const order: string[] = [];
    const stream = textStream(gen(events), { onMood: () => order.push("mood") });
    const reader = stream.getReader();
    const { value } = await reader.read();
    order.push(`text:${value}`);
    await reader.cancel();
    expect(order).toEqual(["mood", "text:Hoi"]);
  });

  it("werkt zonder onMood zoals voorheen", async () => {
    const events: AnimusEvent[] = [
      { type: "mood", emotion: "kalm", intensity: 0.3, values: VALUES },
      { type: "text", delta: "Hoi" },
    ];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hoi"]);
  });

  it("roept onSound aan met de soort en houdt het event uit de tekst", async () => {
    const events: AnimusEvent[] = [
      { type: "mood", emotion: "boos", intensity: 0.8, values: VALUES },
      { type: "sound", kind: "brommen" },
      { type: "text", delta: "Hoi" },
    ];
    const kinds: string[] = [];
    const chunks = await collect(textStream(gen(events), { onSound: (kind) => kinds.push(kind) }));
    expect(kinds).toEqual(["brommen"]);
    expect(chunks).toEqual(["Hoi"]);
  });

  it("roept onLook aan bij een kijk-event en houdt het event uit de tekst", async () => {
    const events: AnimusEvent[] = [
      { type: "kijk" },
      { type: "text", delta: "Hoi" },
    ];
    let calls = 0;
    const chunks = await collect(textStream(gen(events), { onLook: () => calls++ }));
    expect(calls).toBe(1);
    expect(chunks).toEqual(["Hoi"]);
  });

  it("werkt zonder onLook zoals voorheen", async () => {
    const events: AnimusEvent[] = [{ type: "kijk" }, { type: "text", delta: "Hoi" }];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hoi"]);
  });

  it("roept onPersoon aan bij een persoon-event en houdt het event uit de tekst", async () => {
    const events: AnimusEvent[] = [
      { type: "persoon", personId: 7, naam: "Anna" },
      { type: "text", delta: "Hoi" },
    ];
    const calls: unknown[] = [];
    const chunks = await collect(textStream(gen(events), { onPersoon: (personId, naam) => calls.push([personId, naam]) }));
    expect(calls).toEqual([[7, "Anna"]]);
    expect(chunks).toEqual(["Hoi"]);
  });

  it("werkt zonder onPersoon zoals voorheen", async () => {
    const events: AnimusEvent[] = [{ type: "persoon", personId: 7, naam: "Anna" }, { type: "text", delta: "Hoi" }];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hoi"]);
  });

  it("roept onDone aan zodra de beurt (de bron) afgelopen is", async () => {
    const events: AnimusEvent[] = [{ type: "text", delta: "Hoi" }];
    let done = false;
    await collect(textStream(gen(events), { onDone: () => { done = true; } }));
    expect(done).toBe(true);
  });

  it("roept onDone ook aan bij cancel() (onderbroken beurt, barge-in), precies één keer", async () => {
    async function* neverEnding(): AsyncGenerator<AnimusEvent> {
      yield { type: "text", delta: "Hoi" };
      await new Promise(() => {}); // blijft hangen tot cancel() de generator afsluit
    }
    let calls = 0;
    const stream = textStream(neverEnding(), { onDone: () => calls++ });
    const reader = stream.getReader();
    await reader.read(); // eerste chunk ("Hoi")
    await reader.cancel();
    expect(calls).toBe(1);
  });
});
