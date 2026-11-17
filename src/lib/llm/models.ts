import type { ModelDescriptor } from "./types";

// Canonical model registry. Surfaces selection guidance.
// IDs are stable across the app; renaming an underlying provider model
// only requires changing the mapping inside the provider implementation.

export const MODELS: ModelDescriptor[] = [
  { id: "claude-sonnet",  provider: "anthropic", label: "Claude Sonnet",  family: "claude",   speed: "balanced", lengthAdherence: "strict",  style: "Strong narrative voice; great for long-form." },
  { id: "claude-opus",    provider: "anthropic", label: "Claude Opus",    family: "claude",   speed: "slow",     lengthAdherence: "strict",  style: "Best quality; use for hero scripts." },
  { id: "claude-haiku",   provider: "anthropic", label: "Claude Haiku",   family: "claude",   speed: "fast",     lengthAdherence: "medium",  style: "Fast edits & quick rewrites." },
  { id: "gpt-4o",         provider: "openai",    label: "GPT-4o",         family: "gpt",      speed: "balanced", lengthAdherence: "medium",  style: "Versatile; good for chat & ideation." },
  { id: "gpt-4o-mini",    provider: "openai",    label: "GPT-4o mini",    family: "gpt",      speed: "fast",     lengthAdherence: "loose",   style: "Cheap & fast utility model." },
  { id: "gemini-2.5-pro",   provider: "google",    label: "Gemini 2.5 Pro",   family: "gemini",   speed: "balanced", lengthAdherence: "medium",  style: "Strong reasoning; huge context; great for transcripts." },
  { id: "gemini-2.5-flash", provider: "google",    label: "Gemini 2.5 Flash", family: "gemini",   speed: "fast",     lengthAdherence: "medium",  style: "Faster + cheaper; good default for edits." },
  { id: "gemini-1.5-pro",   provider: "google",    label: "Gemini 1.5 Pro",   family: "gemini",   speed: "balanced", lengthAdherence: "medium",  style: "Legacy alias; routed to 2.5 Pro." },
  // Light jobs only, and only for a workspace whose admin allowed it (lib/llm/tiers.ts). "deepseek-chat" was retired by DeepSeek in July 2026.
  { id: "deepseek-flash", provider: "deepseek",  label: "DeepSeek Flash", family: "deepseek", speed: "fast",     lengthAdherence: "medium",  style: "Low-cost; Light jobs only." },
  { id: "grok-2",         provider: "xai",       label: "Grok 2",         family: "grok",     speed: "balanced", lengthAdherence: "medium",  style: "Edgy/punchy voice." },
  { id: "kimi-k1",        provider: "moonshot",  label: "Kimi K1",        family: "kimi",     speed: "balanced", lengthAdherence: "medium",  style: "Long-context Chinese & English." },
  { id: "minimax-abab",   provider: "minimax",   label: "MiniMax abab",   family: "minimax",  speed: "balanced", lengthAdherence: "medium",  style: "Alternative provider." },
  // Mock — always available
  { id: "mock-fast",      provider: "mock",      label: "Mock (fast)",    family: "mock",     speed: "fast",     lengthAdherence: "loose",   style: "Stand-in. Used when USE_MOCK_LLM=true." },
];

export function getModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Providers whose models a person may pick anywhere — a default, a channel's,
 *  an article's (lib/llm/index.ts getProvider). The rest of MODELS are listed
 *  for later and route to the mock today, except LIGHT_ONLY_PROVIDERS. */
export const TEXT_PROVIDERS: readonly string[] = ["anthropic", "google"];

/** Providers the router can call ONLY as a workspace's Light model, and only
 *  once its admin has allowed them (lib/llm/tiers.ts). Never in a general picker. */
export const LIGHT_ONLY_PROVIDERS: readonly string[] = ["deepseek"];
export const LIGHT_ONLY_MODELS = MODELS.filter((m) => LIGHT_ONLY_PROVIDERS.includes(m.provider));
export const isLightOnlyModel = (id: string): boolean => LIGHT_ONLY_MODELS.some((m) => m.id === id);

/** What a person may pick (audit SET-01): wired providers only — no mock, and
 *  not the legacy alias (it still routes, for rows that stored it). */
export const PICKABLE_MODELS = MODELS.filter((m) => TEXT_PROVIDERS.includes(m.provider) && m.id !== "gemini-1.5-pro");

export const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", google: "Google", deepseek: "DeepSeek" };

export const modelLabel = (id: string) => getModel(id)?.label ?? id;
