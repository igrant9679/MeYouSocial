import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

// DeepSeek, as a workspace's LIGHT model only (2026-11-17). The router reaches
// this provider only for a workspace whose admin allowed DeepSeek
// (`ai:allow_deepseek`) AND saved a DeepSeek key — see lib/llm/index.ts.
//
// Written from DeepSeek's own API reference (api-docs.deepseek.com, read
// 2026-11-17): an OpenAI-shaped chat API at POST {base}/chat/completions. Plain
// `fetch`, the way lib/images calls OpenAI — no SDK, no new dependency.
//
// ⚠ Not proven against a real key when this was written (nobody here had one).
// The proof is in the product instead: picking DeepSeek as the Light model makes
// one real call on the workspace's own key and refuses the pick if it doesn't
// answer (app/actions/model-tiers.ts). Do not offer a DeepSeek id anywhere that
// skips that check.

const BASE_URL = "https://api.deepseek.com";

// Our stable id → the name DeepSeek serves. `deepseek-flash` is their moving
// name for the current Flash model (V4.1-Flash on 2026-11-17); the older
// `deepseek-v4-flash` is an alias for it and `deepseek-chat` is retired.
const MODEL_MAP: Record<string, string> = {
  "deepseek-flash": "deepseek-flash",
};

type ChatBody = {
  choices?: Array<{ message?: { content?: string | null }; delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number } | null;
  error?: { message?: string; type?: string; code?: string | number } | null;
};

function body(req: LLMRequest, stream: boolean) {
  const system = [req.systemCached, req.system].filter(Boolean).join("\n\n");
  return {
    model: MODEL_MAP[req.model] ?? MODEL_MAP["deepseek-flash"],
    messages: [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
    ],
    // ⚠ Thinking is ON when this is omitted, and a thinking model spends the
    // cap before it writes — the empty-answer trap Gemini and the current
    // Claude models both set here once. Every `maxTokens` in this codebase
    // bounds the ANSWER, and this is the Light model: thinking is switched off,
    // which also makes `temperature` count (DeepSeek ignores it while thinking).
    thinking: { type: "disabled" as const },
    max_tokens: req.maxTokens ?? 4096,
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    stream,
  };
}

/** The provider's own words for a failed call, with the status first so the router's refusal rules can read it. */
async function failure(res: Response): Promise<Error> {
  let detail = "";
  try {
    const raw = await res.text();
    try { detail = (JSON.parse(raw) as ChatBody).error?.message ?? raw; } catch { detail = raw; }
  } catch { /* no body */ }
  return new Error(`deepseek ${res.status}: ${detail.replace(/\s+/g, " ").slice(0, 300) || res.statusText}`);
}

export function createDeepSeekProvider(apiKey: string): LLMProvider {
  const post = (req: LLMRequest, stream: boolean) =>
    fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body(req, stream)),
      // The router's own timeout answers the caller; this one ends the request itself a little later.
      signal: AbortSignal.timeout((req.timeoutMs ?? 45_000) + 5_000),
    });

  return {
    id: "deepseek",
    supports: (model) => model in MODEL_MAP,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const res = await post(req, false);
      if (!res.ok) throw await failure(res);
      const json = (await res.json()) as ChatBody;
      const choice = json.choices?.[0];
      const text = choice?.message?.content ?? "";
      // An empty string is never a success: say why instead.
      if (!text.trim()) {
        const why = choice?.finish_reason === "length" ? "ran out of room before writing"
          : choice?.finish_reason === "content_filter" ? "declined to answer (content filter)"
          : `returned no text (${choice?.finish_reason ?? "no reason given"})`;
        throw new Error(`deepseek ${why}`);
      }
      return {
        model: req.model,
        content: text,
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        cachedInputTokens: json.usage?.prompt_cache_hit_tokens,
      };
    },
    async *stream(req: LLMRequest): AsyncIterable<string> {
      const res = await post(req, true);
      if (!res.ok) throw await failure(res);
      if (!res.body) throw new Error("deepseek returned no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          let chunk: ChatBody;
          try { chunk = JSON.parse(data) as ChatBody; } catch { continue; }
          if (chunk.error?.message) throw new Error(`deepseek stream: ${chunk.error.message}`);
          const piece = chunk.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        }
      }
    },
  };
}
