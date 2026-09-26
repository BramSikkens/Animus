import { describe, expect, it } from "vitest";
import { ChatContext, ToolContext, type JobContext } from "@livekit/agents";
import type { Brain, BrainEvent } from "@animus/brain";
import { createFaces } from "./faces.js";
import { AnimusAgent } from "./animus-agent.js";

async function* gen(events: BrainEvent[]): AsyncGenerator<BrainEvent> {
  for (const event of events) yield event;
}

function chatCtxWith(text: string): ChatContext {
  const ctx = ChatContext.empty();
  ctx.addMessage({ role: "user", content: text });
  return ctx;
}

describe("AnimusAgent.llmNode", () => {
  it("meldt na leerKennen (persoon-event) de nieuwe Persoon als Gesprekspartner van déze beurt, niet het onbekende signaal van vóór het antwoord", async () => {
    const brain = { hear: () => gen([{ type: "persoon", personId: 42, naam: "Anna" }, { type: "text", delta: "Hoi Anna" }]) } as unknown as Brain;
    const room = { localParticipant: undefined } as unknown as JobContext["room"];
    const faces = createFaces();
    faces.record(null, Date.now(), 1); // onbekend gezicht in beeld -> gesprekspartner start als null (onbekend)
    const reported: (number | null | undefined)[] = [];
    const agent = new AnimusAgent(brain, room, () => {}, () => {}, () => 0.5, undefined, faces, (g: number | null | undefined) => reported.push(g));

    const stream = agent.llmNode(chatCtxWith("Ik ben Anna"), ToolContext.empty());
    for await (const _chunk of (await stream)!) {
      // enkel uitlezen zodat de stream (en dus onDone) afloopt
    }

    expect(reported).toEqual([42]);
  });
});
