import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

// Real Google Gemini provider. Activated when env.USE_MOCK_LLM=false and
// env.GOOGLE_GENAI_API_KEY is set. The router (./index.ts) chooses this provider
// for any model whose descriptor.provider === "google".

// Map our stable model ids → current Gemini model names.
// Update this table when Google rolls a new generation; no other code changes.
//
// ⚠ Do NOT point these at a pinned `gemini-2.5-*` name. Probed against the live
// key on 2026-07-26: `models.list()` still ADVERTISES gemini-2.5-pro/flash, but
// generateContent 404s with "no longer available to new users" — the listing is
// not proof a model is callable for this project. The router swallows provider
// errors and falls back to mock, so a dead name here looks like "Gemini is
// configured" while silently producing mock text. `gemini-pro-latest` and
// `gemini-flash-latest` are the moving aliases Google keeps current; both
// answered a real round-trip on that key.
const MODEL_MAP: Record<string, string> = {
  "gemini-1.5-pro":   "gemini-pro-latest",    // legacy alias bumped to current pro
  "gemini-pro":       "gemini-pro-latest",
  "gemini-flash":     "gemini-flash-latest",
  "gemini-2.5-pro":   "gemini-pro-latest",
  "gemini-2.5-flash": "gemini-flash-latest",
};

export function createGoogleProvider(apiKey: string): LLMProvider {
  const client = new GoogleGenAI({ apiKey });

  function resolveModel(id: string): string {
    return MODEL_MAP[id] ?? MODEL_MAP["gemini-2.5-pro"];
  }

  /** Gemini's API takes a single `contents` array; we map our role-based messages and prepend
   *  the system prompt as a `systemInstruction`. */
  function packRequest(req: LLMRequest) {
    return {
      model: resolveModel(req.model),
      contents: req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      config: {
        systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens ?? 4096,
      },
    };
  }

  return {
    id: "google",
    supports: (model) => model in MODEL_MAP || model.startsWith("gemini-"),
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const res = await client.models.generateContent(packRequest(req));
      const text = res.text ?? "";
      return {
        model: req.model,
        content: text,
        inputTokens: res.usageMetadata?.promptTokenCount,
        outputTokens: res.usageMetadata?.candidatesTokenCount,
      };
    },
    async *stream(req: LLMRequest): AsyncIterable<string> {
      const stream = await client.models.generateContentStream(packRequest(req));
      for await (const chunk of stream) {
        const piece = chunk.text;
        if (piece) yield piece;
      }
    },
  };
}
