import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";
import type { Type2Models } from "./index.js";

const registry = createProviderRegistry({ anthropic, openai });

type RegisteredModelId = Parameters<typeof registry.languageModel>[0];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Ontbrekende omgevingsvariabele: ${name}. Zie .env.example voor de verwachte vorm (provider:model).`,
    );
  }
  return value;
}

function resolveModel(envVarName: string): LanguageModel {
  const value = requireEnv(envVarName);
  if (!value.includes(":")) {
    throw new Error(
      `${envVarName} moet de vorm provider:model hebben (bv. anthropic:claude-haiku-4-5), kreeg: "${value}"`,
    );
  }
  return registry.languageModel(value as RegisteredModelId);
}

export function loadType2Config(): Type2Models {
  return {
    light: resolveModel("TYPE2_LIGHT_MODEL"),
    heavy: resolveModel("TYPE2_HEAVY_MODEL"),
  };
}

// Vaste waarde, geen env-var: Jev via de AI Gateway verandert niet per omgeving.
// AI_GATEWAY_API_KEY leest de AI SDK zelf uit de env.
export const TYPE1_MODEL = "typesafe-ai/jev";

// Vaste waarde: de vector-dimensie zit in het kolomtype (EMBEDDING_DIMENSIONS), wisselen vraagt een migratie (ADR-0008).
export const EMBEDDING_MODEL = openai.embeddingModel("text-embedding-3-small");
