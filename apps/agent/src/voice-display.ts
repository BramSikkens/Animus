import type { DisplayState } from "@animus/core/display";
import type { voice } from "@livekit/agents";

/** LiveKit's AgentState/UserState naar een Weergavetoestand; agent-spreken wint bij overlap (barge-in). */
export function voiceDisplay(agent: voice.AgentState, user: voice.UserState): DisplayState {
  if (agent === "speaking") return "spreekt";
  if (user === "speaking") return "luisterend";
  return "wakker";
}

/** Eigen logica (reflecterend/slapend) wint van de LiveKit-afgeleide toestand (ADR-0011). */
export function resolveDisplay(base: DisplayState, voice: DisplayState): DisplayState {
  return base === "wakker" ? voice : base;
}
