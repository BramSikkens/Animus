import { describe, expect, it } from "vitest";
import { ChatContext, ToolContext, type JobContext } from "@livekit/agents";
import type { Animus, AnimusEvent } from "@animus/core";
import type { Gesprekspartner } from "@animus/core/perception";
import { createFaces } from "./faces.js";
import { AnimusAgent, type AnimusAgentOptions } from "./animus-agent.js";
import type { SpeakerId } from "./speaker-id.js";

async function* gen(events: AnimusEvent[]): AsyncGenerator<AnimusEvent> {
  for (const event of events) yield event;
}

function chatCtxWith(text: string): ChatContext {
  const ctx = ChatContext.empty();
  ctx.addMessage({ role: "user", content: text });
  return ctx;
}

describe("AnimusAgent.llmNode", () => {
  it("meldt na leerKennen (persoon-event) de nieuwe Persoon als Gesprekspartner van déze beurt, niet het onbekende signaal van vóór het antwoord", async () => {
    const animus = { hear: () => gen([{ type: "persoon", personId: 42, naam: "Anna" }, { type: "text", delta: "Hoi Anna" }]) } as unknown as Animus;
    const room = { localParticipant: undefined } as unknown as JobContext["room"];
    const faces = createFaces();
    faces.record(null, Date.now(), 1); // onbekend gezicht in beeld -> gesprekspartner start als onbekend
    const reported: Gesprekspartner[] = [];
    const agent = new AnimusAgent({ animus, room, onUtterance: () => {}, onMoodValues: () => {}, faces, onBeurtAfgelopen: (g) => reported.push(g) });

    const stream = agent.llmNode(chatCtxWith("Ik ben Anna"), ToolContext.empty());
    for await (const _chunk of (await stream)!) {
      // enkel uitlezen zodat de stream (en dus onDone) afloopt
    }

    expect(reported).toEqual([{ soort: "persoon", personId: 42 }]);
  });

  // Stem-inschrijving (#107): beurt 1 leert Anna (42) kennen, daarna blijft haar stem onherkend.
  function enrollingSetup(enrollStatus: "bezig" | "opgegeven") {
    const heard: { gesprekspartner?: Gesprekspartner }[] = [];
    const animus = {
      hear: (_text: string, options: { gesprekspartner?: Gesprekspartner }) => {
        heard.push(options);
        return gen(heard.length === 1 ? [{ type: "persoon", personId: 42, naam: "Anna" }] : [{ type: "text", delta: "Ja" }]);
      },
    } as unknown as Animus;
    const room = { localParticipant: undefined } as unknown as JobContext["room"];
    const speakerId = { identify: () => null, enroll: async () => enrollStatus, reload: async () => {}, dispose: () => {} } satisfies SpeakerId;
    const audio = { drain: () => new Int16Array(16) } as unknown as NonNullable<AnimusAgentOptions["speaker"]>["audio"];
    const agent = new AnimusAgent({ animus, room, onUtterance: () => {}, onMoodValues: () => {}, speaker: { speakerId, audio }, faces: createFaces() });
    const turn = async (text: string): Promise<void> => {
      for await (const _chunk of (await agent.llmNode(chatCtxWith(text), ToolContext.empty()))!) {
        // uitlezen
      }
      await new Promise((resolve) => setTimeout(resolve, 0)); // enroll().then(...) laten afhandelen
    };
    return { agent, heard, turn };
  }

  it("een onherkende stem tijdens een lopende inschrijving is de inschrijvende Persoon", async () => {
    const { heard, turn } = enrollingSetup("bezig");
    await turn("Ik ben Anna");
    await turn("Hoe gaat het?");
    expect(heard[1]!.gesprekspartner).toEqual({ soort: "persoon", personId: 42 });
  });

  it("na een opgegeven inschrijving is een onherkende stem niet meer die Persoon", async () => {
    const { heard, turn } = enrollingSetup("opgegeven");
    await turn("Ik ben Anna");
    await turn("Hoe gaat het?"); // enroll() geeft op
    await turn("En nu?");
    expect(heard[2]!.gesprekspartner).toEqual({ soort: "onbekend" });
  });

  it("na cancelEnrollment (persons:/wissel/slapen) is een onherkende stem niet meer de inschrijvende Persoon", async () => {
    const { agent, heard, turn } = enrollingSetup("bezig");
    await turn("Ik ben Anna");
    agent.cancelEnrollment();
    await turn("Hoe gaat het?");
    expect(heard[1]!.gesprekspartner).toEqual({ soort: "onbekend" });
  });

  it("een actieve camera zonder gezicht in beeld en zonder stemherkenning maakt de Gesprekspartner onbekend, niet de eigenaar (#115)", async () => {
    const heard: { gesprekspartner?: Gesprekspartner }[] = [];
    const animus = { hear: (_text: string, options: { gesprekspartner?: Gesprekspartner }) => (heard.push(options), gen([{ type: "text", delta: "Ja" }])) } as unknown as Animus;
    const room = { localParticipant: undefined } as unknown as JobContext["room"];
    const agent = new AnimusAgent({ animus, room, onUtterance: () => {}, onMoodValues: () => {}, faces: createFaces(), cameraActive: () => true });

    for await (const _chunk of (await agent.llmNode(chatCtxWith("Hallo"), ToolContext.empty()))!) {
      // uitlezen
    }

    expect(heard[0]!.gesprekspartner).toEqual({ soort: "onbekend" });
  });
});
