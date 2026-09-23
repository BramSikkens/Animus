import { ReadableStream } from "node:stream/web";
import { describe, expect, it } from "vitest";
import type { BrainEvent } from "@animus/brain";
import { textStream } from "./text-stream.js";

async function* gen(events: BrainEvent[]): AsyncGenerator<BrainEvent> {
  for (const event of events) yield event;
}

async function collect(stream: ReadableStream<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("textStream", () => {
  it("geeft alleen text-deltas door, in volgorde", async () => {
    const events: BrainEvent[] = [
      { type: "text", delta: "Hallo" },
      { type: "text", delta: " daar" },
    ];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hallo", " daar"]);
  });

  it("slaat emotion- en tool-*-events over", async () => {
    const events: BrainEvent[] = [
      { type: "emotion", emotion: "blij", intensity: 0.8 },
      { type: "text", delta: "Hoi" },
      { type: "tool-call", toolName: "huidige_tijd", input: {} },
      { type: "tool-result", toolName: "huidige_tijd", output: "12:00" },
      { type: "text", delta: "!" },
    ];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hoi", "!"]);
  });

  it("eindigt de stream netjes als de bron gooit, zonder de consumer te laten crashen", async () => {
    async function* throwing(): AsyncGenerator<BrainEvent> {
      yield { type: "text", delta: "Voor de fout" };
      throw new Error("brain.hear() faalde");
    }
    const chunks = await collect(textStream(throwing()));
    expect(chunks).toEqual(["Voor de fout"]);
  });

  it("roept onEmotion aan met de juiste emotie en intensiteit", async () => {
    const events: BrainEvent[] = [
      { type: "emotion", emotion: "blij", intensity: 0.8 },
      { type: "text", delta: "Hoi" },
    ];
    const calls: Array<[string, number]> = [];
    await collect(textStream(gen(events), { onEmotion: (emotion, intensity) => calls.push([emotion, intensity]) }));
    expect(calls).toEqual([["blij", 0.8]]);
  });

  it("roept onEmotion aan vóór de eerste tekst gelezen kan worden", async () => {
    const events: BrainEvent[] = [
      { type: "emotion", emotion: "boos", intensity: 0.5 },
      { type: "text", delta: "Hoi" },
    ];
    const order: string[] = [];
    const stream = textStream(gen(events), { onEmotion: () => order.push("emotion") });
    const reader = stream.getReader();
    const { value } = await reader.read();
    order.push(`text:${value}`);
    await reader.cancel();
    expect(order).toEqual(["emotion", "text:Hoi"]);
  });

  it("werkt zonder onEmotion zoals voorheen", async () => {
    const events: BrainEvent[] = [
      { type: "emotion", emotion: "kalm", intensity: 0.3 },
      { type: "text", delta: "Hoi" },
    ];
    const chunks = await collect(textStream(gen(events)));
    expect(chunks).toEqual(["Hoi"]);
  });
});
