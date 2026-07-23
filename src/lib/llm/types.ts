// LLM provider abstraction. Every provider — real or mock —
// implements this interface so the router can swap them transparently.

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMRequest = {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Optional system prompt; merged with messages by the provider. */
  system?: string;
  /** Multi-tenant: resolve the provider key for THIS workspace (its own key
   *  wins over the platform's). Omitted = platform/global key. */
  workspaceId?: string;
};

export type LLMResponse = {
  model: string;
  content: string;
  /** Approximate; providers may report exact counts. */
  inputTokens?: number;
  outputTokens?: number;
};

export interface LLMProvider {
  /** Unique provider id, e.g. "anthropic" | "openai" | "mock". */
  id: string;
  /** Models this provider can serve, e.g. ["claude-sonnet","claude-opus"]. */
  supports(model: string): boolean;
  /** One-shot completion. */
  complete(req: LLMRequest): Promise<LLMResponse>;
  /** Streaming completion — yields text deltas. */
  stream(req: LLMRequest): AsyncIterable<string>;
}

export type ModelDescriptor = {
  id: string;            // canonical id used in code/UI/router (e.g. "claude-sonnet")
  provider: string;      // provider id
  label: string;         // for UI
  family: string;        // claude | gpt | gemini | deepseek | grok | kimi | minimax | mock
  // selection guidance
  speed: "fast" | "balanced" | "slow";
  lengthAdherence: "loose" | "medium" | "strict";
  style: string;         // short human-readable note
};
