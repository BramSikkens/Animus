import { expect, test } from "vitest";
import { z } from "zod";
import { genesisSchema } from "../src/index.js";

// OpenAI's strikte structured output eist dat élke sleutel in `required` staat (optioneel kan alleen als nullable).
test("genesisSchema heeft elke sleutel verplicht", () => {
  const json = z.toJSONSchema(genesisSchema) as { properties: Record<string, unknown>; required?: string[] };
  expect([...(json.required ?? [])].sort()).toEqual(Object.keys(json.properties).sort());
});
