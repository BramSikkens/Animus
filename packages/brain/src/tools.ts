import { tool } from "ai";
import { z } from "zod";

// Een nieuwe tool = één extra entry met een Zod-schema; Type2 beslist zelf wanneer hij hem gebruikt.
export function createTools(deps: { now: () => Date; remember: (text: string) => Promise<boolean> }) {
  return {
    current_datetime: tool({
      description: "Geeft de huidige datum en tijd. Gebruik dit als iemand vraagt welke dag, datum of tijd het is.",
      inputSchema: z.object({}),
      // ponytail: tijdzone vast op Europe/Brussels (de eigenaar woont in België); configureerbaar maken bij verhuis.
      execute: async () => ({
        datetime: deps.now().toLocaleString("nl-BE", {
          timeZone: "Europe/Brussels",
          dateStyle: "full",
          timeStyle: "short",
        }),
      }),
    }),
    remember: tool({
      description:
        "Slaat iets expliciet op als herinnering. Gebruik dit als de gesprekspartner vraagt om iets te onthouden.",
      inputSchema: z.object({ text: z.string().min(1).describe("Wat je moet onthouden, als volledige zin.") }),
      execute: async ({ text }) => ({ remembered: await deps.remember(text) }),
    }),
  };
}
