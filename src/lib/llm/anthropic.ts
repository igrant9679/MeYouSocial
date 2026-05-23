import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

// Real Anthropic Claude provider. Activated when env.USE_MOCK_LLM=false and
// env.ANTHROPIC_API_KEY is set. The router (./index.ts) chooses this provider
// for any model whose descriptor.provider === "anthropic".

// Map our stable model ids → current Anthropic model names. Update this
// table when Anthropic rolls a new generation; no other code changes.
const MODEL_MAP: Record<string, string> = {
  "claude-sonnet": "claude-sonnet-4-5-20250929",
  "claude-opus":   "claude-opus-4-1-20250805",
  "claude-haiku":  "claude-haiku-4-5-20251001",
};

export function createAnthropicProvider(apiKey: string): LLMProvider {
  const client = new Anthropic({ apiKey });

  function resolveModel(id: string): string {
    return MODEL_MAP[id] ?? MODEL_MAP["claude-sonnet"];
  }

  function packMessages(req: LLMRequest): { system: string | undefined; messages: { role: "user" | "assistant"; content: string }[] } {
    // Claude's API expects the system prompt as a top-level field, not in messages.
    return {
      system: req.system,
      messages: req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    };
  }

  return {
    id: "anthropic",
    supports: (model) => model in MODEL_MAP || model.startsWith("claude-"),
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const { system, messages } = packMessages(req);
      const res = await client.messages.create({
        model: resolveModel(req.model),
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature,
        system,
        messages,
      });
      const text = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      return {
        model: req.model,
        content: text,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    },
    async *stream(req: LLMRequest): AsyncIterable<string> {
      const { system, messages } = packMessages(req);
      const stream = client.messages.stream({
        model: resolveModel(req.model),
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature,
        system,
        messages,
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    },
  };
}
