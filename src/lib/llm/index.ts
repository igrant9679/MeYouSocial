import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";
import { mockProvider } from "./mock";
import { createAnthropicProvider } from "./anthropic";
import { MODELS, getModel } from "./models";

// Routing layer (FR-MODEL-04). Application code uses llm.complete() / llm.stream()
// and never imports a concrete provider. Adding a new provider = add an entry
// in MODELS + an implementation file + one branch below.

// Lazy provider singletons keyed by id so we only instantiate the SDKs once per
// process when actually used.
const providerCache = new Map<string, LLMProvider>();
function getProvider(id: string): LLMProvider {
  if (providerCache.has(id)) return providerCache.get(id)!;
  let provider: LLMProvider;
  switch (id) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) return mockProvider;
      provider = createAnthropicProvider(env.ANTHROPIC_API_KEY);
      break;
    // Other providers go here as we wire them up (openai, google, deepseek, xai, moonshot, minimax).
    default:
      provider = mockProvider;
  }
  providerCache.set(id, provider);
  return provider;
}

function selectProvider(model: string): LLMProvider {
  if (env.USE_MOCK_LLM) return mockProvider;
  const descriptor = getModel(model);
  if (!descriptor) return mockProvider;
  return getProvider(descriptor.provider);
}

export const llm = {
  models: MODELS,
  defaultModel: env.DEFAULT_LLM_MODEL,
  async complete(req: LLMRequest): Promise<LLMResponse> {
    return selectProvider(req.model).complete(req);
  },
  stream(req: LLMRequest): AsyncIterable<string> {
    return selectProvider(req.model).stream(req);
  },
};

export type { LLMRequest, LLMResponse, LLMProvider } from "./types";
export type { ModelDescriptor } from "./types";
