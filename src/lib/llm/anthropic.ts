import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

// Real Anthropic Claude provider. Activated when env.USE_MOCK_LLM=false and
// env.ANTHROPIC_API_KEY is set. The router (./index.ts) chooses this provider
// for any model whose descriptor.provider === "anthropic".

// Map our stable model ids → current Anthropic model names. Update this
// table when Anthropic rolls a new generation.
//
// ⚠ A new generation is NOT only a new name (2026-11-17, the move off
// claude-sonnet-4-5, which Anthropic retires on 2026-11-30 — opus-4-1 had
// already been retired on 2026-08-05 and nobody noticed, because the router
// turns a 404 into placeholder text). The 5.5 models:
//   · refuse `temperature` / `top_p` / `top_k` with a 400 — never send them;
//   · think before they write, and the thinking counts toward `max_tokens` —
//     a cap of 300 can be spent before the first word (REASONING_ROOM below);
//   · take `output_config.effort`, the one reasoning control all three accept.
//     ⚠ Don't turn thinking off per model instead: Sonnet 5.5 refuses
//     `thinking: disabled`, Opus 5.5 can't, and `budget_tokens` is a 400 on all;
//   · can decline with HTTP 200 and `stop_reason: "refusal"` and no text.
// Probe an id against a real key before shipping it (CLAUDE.md, "probe first").
const MODEL_MAP: Record<string, string> = {
  "claude-sonnet": "claude-sonnet-5-5",
  "claude-opus":   "claude-opus-5-5",
  "claude-haiku":  "claude-haiku-5-5",
};

/**
 * Every `maxTokens` in this codebase means "bound the ANSWER". The model's
 * reasoning is paid for out of the same number, so it is padded on top here,
 * centrally — the same allowance google.ts gives Gemini, for the same reason.
 */
const REASONING_ROOM = 4096;

/** A short answer is a small job; anything longer gets a middling effort. A caller can ask for more. */
function effortFor(req: LLMRequest): NonNullable<LLMRequest["effort"]> {
  if (req.effort) return req.effort;
  return (req.maxTokens ?? 4096) <= 1500 ? "low" : "medium";
}

// ⚠ These messages are read by provider-health's refusalKind(): keep them free
// of status-code-looking numbers and of the words it matches (quota, credit,
// key, not found) — a model declining ONE prompt is not a provider refusing a
// workspace, and must not raise an Inbox card.
const DECLINED = "Claude declined to answer this request (stop reason: refusal)";
const NO_ROOM = "Claude used its whole allowance thinking and wrote nothing (stop reason: max_tokens)";
const EMPTY = "Claude returned no text";

/** An empty string is never a success: the router falls back and stamps the reply "mock". */
function emptyReason(stopReason: string | null | undefined): string {
  return stopReason === "refusal" ? DECLINED : stopReason === "max_tokens" ? NO_ROOM : EMPTY;
}

export function createAnthropicProvider(apiKey: string): LLMProvider {
  const client = new Anthropic({ apiKey });

  function resolveModel(id: string): string {
    return MODEL_MAP[id] ?? MODEL_MAP["claude-sonnet"];
  }

  function packMessages(req: LLMRequest): { system: string | Anthropic.TextBlockParam[] | undefined; messages: { role: "user" | "assistant"; content: string }[] } {
    // Claude's API expects the system prompt as a top-level field, not in messages.
    // A stable prefix is its own block, marked for the prompt cache (E-ENG-08):
    // the assistant's ~10k-token manual is then read at a tenth of the price.
    const system: string | Anthropic.TextBlockParam[] | undefined = req.systemCached
      ? [{ type: "text", text: req.systemCached, cache_control: { type: "ephemeral" } }, ...(req.system ? [{ type: "text" as const, text: req.system }] : [])]
      : req.system;
    return {
      system,
      messages: req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    };
  }

  /** One request shape for both paths. No `temperature`, and `thinking` is left to the model (adaptive). */
  function packRequest(req: LLMRequest) {
    return {
      model: resolveModel(req.model),
      max_tokens: (req.maxTokens ?? 4096) + REASONING_ROOM,
      output_config: { effort: effortFor(req) },
      ...packMessages(req),
    };
  }

  return {
    id: "anthropic",
    supports: (model) => model in MODEL_MAP || model.startsWith("claude-"),
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const res = await client.messages.create(packRequest(req));
      // By block type: a reply can open with a thinking block.
      const text = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      // A refusal carries no usable answer even when a few words came with it;
      // a reply cut off at the cap keeps what it wrote, as before.
      if (res.stop_reason === "refusal") throw new Error(DECLINED);
      if (!text.trim()) throw new Error(emptyReason(res.stop_reason));
      // input_tokens excludes what the cache wrote and read; the total is what was processed.
      const cacheRead = res.usage.cache_read_input_tokens ?? 0;
      const cacheWrite = res.usage.cache_creation_input_tokens ?? 0;
      return {
        model: req.model,
        content: text,
        inputTokens: res.usage.input_tokens + cacheRead + cacheWrite,
        // Includes the model's thinking — that is what was billed.
        outputTokens: res.usage.output_tokens,
        cachedInputTokens: cacheRead,
      };
    },
    async *stream(req: LLMRequest): AsyncIterable<string> {
      const stream = client.messages.stream(packRequest(req));
      let wrote = false;
      let stopReason: string | null = null;
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          if (event.delta.text) wrote = true;
          yield event.delta.text;
        } else if (event.type === "message_delta") {
          stopReason = event.delta.stop_reason ?? stopReason;
        }
      }
      // ⚠ Only when NOTHING was written: the router answers a throw with the
      // placeholder, and after real text that would append it to the reply.
      if (!wrote) throw new Error(emptyReason(stopReason));
    },
  };
}
