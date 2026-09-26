import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";
import type { Type2Models } from "./index.js";

const registry = createProviderRegistry({ anthropic, openai });

type RegisteredModelId = Parameters<typeof registry.languageModel>[0];

// Curated catalogus voor het modelwissel-experiment (#123): enkel modellen die de geïnstalleerde
// @ai-sdk/anthropic (4.0.61) en @ai-sdk/openai (4.0.73) kennen. Vervolgstap buiten scope: Google Gemini.
export const TYPE2_MODEL_CATALOG = [
  "anthropic:claude-haiku-4-5",
  "anthropic:claude-sonnet-4-5",
  "anthropic:claude-opus-4-1",
  "openai:gpt-5-mini",
  "openai:gpt-5",
] as const;

// Provider-prefix (vóór de ":") → env-var met de bijbehorende sleutel; bepaalt welke catalogus-modellen
// beschikbaar zijn zonder dat er echt een aanroep gebeurt.
const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Ontbrekende omgevingsvariabele: ${name}. Zie .env.example voor de verwachte vorm (provider:model).`,
    );
  }
  return value;
}

function requireModelEnv(env: NodeJS.ProcessEnv, envVarName: string): string {
  const value = requireEnv(env, envVarName);
  if (!value.includes(":")) {
    throw new Error(
      `${envVarName} moet de vorm provider:model hebben (bv. anthropic:claude-haiku-4-5), kreeg: "${value}"`,
    );
  }
  return value;
}

export type Type2Catalog = {
  /** provider:model-ids waaruit gekozen mag worden: de catalogus gefilterd op providers met een sleutel, aangevuld met de env-standaarden zelf (ook als die niet in de catalogus staan). */
  available: string[];
  /** Lost een provider:model-id op naar een LanguageModel, via dezelfde registry als de env-standaarden. */
  resolve(id: string): LanguageModel;
  /** TYPE2_LIGHT_MODEL/TYPE2_HEAVY_MODEL: de terugval zonder eigen instelling. */
  defaults: { light: string; heavy: string };
};

/** Puur op `env` (default `process.env`): test geeft desgewenst een eigen omgeving mee zonder echte env-vars te raken. */
export function type2Catalog(env: NodeJS.ProcessEnv = process.env): Type2Catalog {
  const defaults = { light: requireModelEnv(env, "TYPE2_LIGHT_MODEL"), heavy: requireModelEnv(env, "TYPE2_HEAVY_MODEL") };
  const filtered = TYPE2_MODEL_CATALOG.filter((id) => Boolean(env[PROVIDER_KEY_ENV[id.split(":", 1)[0]!]!]));
  const available = [...new Set([...filtered, defaults.light, defaults.heavy])];
  return { available, resolve: (id) => registry.languageModel(id as RegisteredModelId), defaults };
}

export function loadType2Config(env: NodeJS.ProcessEnv = process.env): Type2Models {
  const { defaults, resolve } = type2Catalog(env);
  return { light: resolve(defaults.light), heavy: resolve(defaults.heavy) };
}

// Vaste waarde, geen env-var: Jev via de AI Gateway verandert niet per omgeving.
// AI_GATEWAY_API_KEY leest de AI SDK zelf uit de env.
export const TYPE1_MODEL = "typesafe-ai/jev";

// Vaste waarde: de vector-dimensie zit in het kolomtype (EMBEDDING_DIMENSIONS), wisselen vraagt een migratie (ADR-0008).
export const EMBEDDING_MODEL = openai.embeddingModel("text-embedding-3-small");
