import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";
import {
  OPENROUTER_FALLBACK_MODEL, defaultOpenRouterModel, effortFor, knownOpenRouterModel, openrouterSlug,
  parseOpenRouterModels, rememberOpenRouterModels, type OpenRouterModel,
} from "./openrouter-catalog";

// OpenRouter (2026-11-27, the owner's OpenRouter decisions): one key for many vendors' text
// models, at OpenAI's request shape. A provider beside Anthropic, Google and DeepSeek; it
// replaces none of them. Plain `fetch`, like deepseek.ts — no SDK, no new dependency.
//
// Checked against https://openrouter.ai/docs on 2026-11-27 (and Velocity's build of the same
// day, igrant9679/usip#100):
//   - chat at POST /api/v1/chat/completions, Bearer key; streaming is SSE (`data:` lines, and
//     `: OPENROUTER PROCESSING` comment lines while it waits, which are skipped);
//   - GET /api/v1/models needs no key; each model lists `supported_parameters` and, for a
//     reasoning model, `reasoning.supported_efforts`;
//   - GET /api/v1/key reports a key's limit, what is left and what it used;
//   - `usage` (with `cost`, in USD) comes back on every response — the old
//     `usage: { include: true }` switch is deprecated and does nothing;
//   - errors are { error: { code, message, metadata } }, and a 200 can still carry one (a
//     provider failed after accepting the request);
//   - optional attribution headers HTTP-Referer (the app's URL) and X-Title (its name).
//
// ⚠ Not proven against a real key when this was written (no key on this install yet). The
// requests follow the docs; the first real call is the owner's, after the shared key is in.

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_CHAT_URL = `${OPENROUTER_API_BASE}/chat/completions`;
export const OPENROUTER_MODELS_URL = `${OPENROUTER_API_BASE}/models`;
export const OPENROUTER_KEY_URL = `${OPENROUTER_API_BASE}/key`;

/** Every `maxTokens` in this codebase bounds the ANSWER; a reasoning model's thinking comes out of the same cap. */
const REASONING_ROOM = 4096;

/**
 * The headers of every OpenRouter request. The attribution headers name the app — its public
 * address and "MeYouSocial Publisher" — and nothing else: never a member's name or email.
 */
export function openrouterHeaders(apiKey?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(env.APP_URL ? { "HTTP-Referer": env.APP_URL.replace(/\/+$/, "") } : {}),
    "X-Title": "MeYouSocial Publisher",
  };
}

/* ─── Errors ──────────────────────────────────────────────────────────────── */

type ErrorBody = { error?: { message?: unknown; code?: unknown; metadata?: { raw?: unknown; provider_name?: unknown } } | null };

/** OpenRouter's own words from an error body; when a provider behind it failed, that provider's answer is added. */
export function openrouterErrorText(body: unknown): string {
  let err: ErrorBody["error"];
  if (typeof body === "string") {
    try { err = (JSON.parse(body) as ErrorBody).error; } catch { return body.replace(/\s+/g, " ").trim().slice(0, 300) || "no message"; }
  } else {
    err = (body as ErrorBody | null)?.error;
  }
  const message = typeof err?.message === "string" && err.message.trim() ? err.message.trim() : "no message";
  const raw = err?.metadata?.raw;
  const rawText = typeof raw === "string" ? raw : raw != null ? JSON.stringify(raw) : "";
  const provider = typeof err?.metadata?.provider_name === "string" ? ` (${err.metadata.provider_name})` : "";
  const said = rawText && !message.includes(rawText) ? `${message}${provider}: ${rawText}` : message;
  return said.replace(/\s+/g, " ").slice(0, 300);
}

/**
 * A failed request in words, with OpenRouter's own message. ⚠ The status goes first because
 * provider-health's refusalKind() reads it: 401 → the key, 402 → credit, 429 → rate limit,
 * 404 → the model. A 403 is OpenRouter's moderation refusing one prompt, not the key, so its
 * message carries no status number (or the Inbox would say the key was rejected).
 */
export function openrouterFailure(status: number, body: unknown): Error & { status: number } {
  const said = openrouterErrorText(body);
  const message =
    status === 401 ? `openrouter 401: the OpenRouter key is wrong or has been revoked. OpenRouter said: ${said}`
    : status === 402 ? `openrouter 402: the OpenRouter key is out of credit — add credit at openrouter.ai or raise the key's limit. OpenRouter said: ${said}`
    : status === 429 ? `openrouter 429: OpenRouter is rate limiting this key. OpenRouter said: ${said}`
    : status === 404 ? `openrouter 404: OpenRouter doesn't serve this model. OpenRouter said: ${said}`
    : status === 403 ? `openrouter refused this request (moderation flagged it). OpenRouter said: ${said}`
    : `openrouter ${status}: ${said}`;
  return Object.assign(new Error(message), { status });
}

/** Worth another try: a timeout, a rate limit, or the provider side being down. */
export const OPENROUTER_RETRYABLE: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** How long to wait before try `attempt` (1, 2): Retry-After when OpenRouter sends one, capped so the router's timeout still answers. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const secs = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 5000);
  return attempt === 1 ? 1000 : 3000;
}

/* ─── The model list ──────────────────────────────────────────────────────── */

/** "A few hours" (the spec): the list changes when OpenRouter adds a model, not by the minute. */
const MODELS_TTL_MS = 3 * 60 * 60 * 1000;

export type OpenRouterModelList = { models: OpenRouterModel[]; fetchedAt: number | null; error: string | null };

let cache: { at: number; models: OpenRouterModel[] } | null = null;
let lastError: string | null = null;
let lastAttempt = 0;
let inflight: Promise<OpenRouterModelList> | null = null;

/**
 * OpenRouter's models, read at most every three hours (and, after a failure, not again for a
 * minute, so a page full of pickers can't hammer it). A failed read keeps the last good list
 * and says why; with no list at all it returns none — never a made-up list.
 */
export async function getOpenRouterModels(now: number = Date.now()): Promise<OpenRouterModelList> {
  if (cache && now - cache.at < MODELS_TTL_MS) return { models: cache.models, fetchedAt: cache.at, error: null };
  if (lastError && now - lastAttempt < 60_000) return { models: cache?.models ?? [], fetchedAt: cache?.at ?? null, error: lastError };
  if (inflight) return inflight;
  lastAttempt = now;
  inflight = (async () => {
    try {
      const res = await fetch(OPENROUTER_MODELS_URL, { headers: openrouterHeaders(), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`OpenRouter's model list answered ${res.status}: ${openrouterErrorText(await res.text().catch(() => ""))}`);
      const models = parseOpenRouterModels(await res.json());
      if (models.length === 0) throw new Error("OpenRouter's model list came back empty");
      cache = { at: now, models };
      rememberOpenRouterModels(models);
      lastError = null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(`[openrouter] could not read the model list: ${lastError}`);
    } finally {
      inflight = null;
    }
    return { models: cache?.models ?? [], fetchedAt: cache?.at ?? null, error: lastError };
  })();
  return inflight;
}

/** One model's listing. `known: false` = the list couldn't be read, so nothing can be said about the model either way. */
export async function lookupOpenRouterModel(slug: string): Promise<{ known: boolean; model: OpenRouterModel | null }> {
  const list = await getOpenRouterModels();
  if (list.models.length === 0) return { known: false, model: null };
  return { known: true, model: list.models.find((m) => m.slug === slug) ?? null };
}

/** The default model's OpenRouter id: the newest Claude Sonnet that takes tools, from the live list. */
export async function defaultOpenRouterSlug(): Promise<string> {
  const list = await getOpenRouterModels();
  return defaultOpenRouterModel(list.models)?.slug ?? OPENROUTER_FALLBACK_MODEL;
}

/** Test seam: the list is cached per process. */
export function __setOpenRouterModelsForTests(models: OpenRouterModel[] | null, error: string | null = null): void {
  cache = models ? { at: Date.now(), models } : null;
  if (models) rememberOpenRouterModels(models);
  lastError = error;
  lastAttempt = error ? Date.now() : 0;
  inflight = null;
}

/* ─── The key check ───────────────────────────────────────────────────────── */

/** What a key check reports — never the key's label (OpenRouter's default label is the key itself, shortened). */
export type OpenRouterKeyInfo = { limit: number | null; limitRemaining: number | null; usage: number | null; isFreeTier: boolean };

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Asks OpenRouter about a key (GET /api/v1/key). Throws OpenRouter's own message when it refuses the key. Nothing about the key is logged. */
export async function checkOpenRouterKey(apiKey: string): Promise<OpenRouterKeyInfo> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_KEY_URL, { headers: openrouterHeaders(apiKey), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Error(`Couldn't reach OpenRouter to check the key: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw openrouterFailure(res.status, await res.text().catch(() => ""));
  const data = ((await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null)?.data ?? {};
  return { limit: numOrNull(data.limit), limitRemaining: numOrNull(data.limit_remaining), usage: numOrNull(data.usage), isFreeTier: data.is_free_tier === true };
}

/** "Valid — $4.20 of $10.00 credit left on this key." / "Valid — no credit limit set on this key." */
export function describeKeyCheck(info: OpenRouterKeyInfo): string {
  if (info.limit !== null && info.limitRemaining !== null) return `Valid — $${info.limitRemaining.toFixed(2)} of $${info.limit.toFixed(2)} credit left on this key.`;
  return info.isFreeTier ? "Valid — a free-tier key, so only free models will answer." : "Valid — no credit limit is set on this key.";
}

/* ─── The provider ────────────────────────────────────────────────────────── */

type ChatBody = ErrorBody & {
  choices?: Array<{ message?: { content?: string | null }; delta?: { content?: string | null }; finish_reason?: string | null; error?: { message?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null; cost?: number } | null;
};

/** The request body for a model, using what its listing says it takes (`m` absent = the list couldn't be read). */
export function openrouterBody(req: LLMRequest, stream: boolean, m: OpenRouterModel | undefined) {
  const system = [req.systemCached, req.system].filter(Boolean).join("\n\n");
  const params = m?.supportedParameters ?? [];
  const reasons = params.includes("reasoning");
  // Same rule as the Anthropic adapter: a short answer is a small job, anything longer a middling one.
  const wanted = req.effort ?? ((req.maxTokens ?? 4096) <= 1500 ? "low" : "medium");
  return {
    model: openrouterSlug(req.model),
    messages: [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...req.messages.filter((x) => x.role !== "system").map((x) => ({ role: x.role, content: x.content })),
    ],
    max_tokens: (req.maxTokens ?? 4096) + (reasons ? REASONING_ROOM : 0),
    // Thinking is billed but not shown: `exclude` keeps it out of the answer text.
    ...(reasons ? { reasoning: { effort: effortFor(wanted, m?.supportedEfforts ?? []), exclude: true } } : {}),
    // Sent only to a model that lists it — the current Claude models refuse it (anthropic.ts).
    ...(req.temperature !== undefined && params.includes("temperature") ? { temperature: req.temperature } : {}),
    stream,
  };
}

/** An empty answer is never a success: the router falls back and stamps the reply "mock". Kept free of words provider-health reads. */
function emptyReason(finish: string | null | undefined): string {
  return finish === "length" ? "openrouter: the model ran out of room before writing (finish reason: length)"
    : finish === "content_filter" ? "openrouter: the model declined to answer (content filter)"
    : `openrouter: the model returned no text (finish reason: ${finish ?? "none given"})`;
}

export function createOpenRouterProvider(apiKey: string, fetchImpl: typeof fetch = fetch): LLMProvider {
  async function post(req: LLMRequest, stream: boolean): Promise<Response> {
    const slug = openrouterSlug(req.model);
    const m = (await lookupOpenRouterModel(slug).catch(() => ({ model: null }))).model ?? knownOpenRouterModel(slug);
    const body = JSON.stringify(openrouterBody(req, stream, m ?? undefined));
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: openrouterHeaders(apiKey),
        body,
        // The router's own timeout answers the caller; this one ends the request itself a little later.
        signal: AbortSignal.timeout((req.timeoutMs ?? 45_000) + 5_000),
      });
      if (res.ok || !OPENROUTER_RETRYABLE.has(res.status) || attempt >= 2) return res;
      await res.text().catch(() => "");
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt + 1, res.headers.get("retry-after"))));
    }
  }

  return {
    id: "openrouter",
    supports: (model) => model.startsWith("openrouter:"),
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const res = await post(req, false);
      if (!res.ok) throw openrouterFailure(res.status, await res.text().catch(() => ""));
      const json = (await res.json()) as ChatBody;
      if (json.error) throw openrouterFailure(Number(json.error.code) || 502, json);
      const choice = json.choices?.[0];
      if (choice?.error?.message) throw new Error(`openrouter: ${choice.error.message}`);
      const text = choice?.message?.content ?? "";
      if (!text.trim()) throw new Error(emptyReason(choice?.finish_reason));
      return {
        model: req.model,
        content: text,
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        cachedInputTokens: json.usage?.prompt_tokens_details?.cached_tokens,
        costUsd: typeof json.usage?.cost === "number" && Number.isFinite(json.usage.cost) ? json.usage.cost : undefined,
      };
    },
    async *stream(req: LLMRequest): AsyncIterable<string> {
      const res = await post(req, true);
      if (!res.ok) throw openrouterFailure(res.status, await res.text().catch(() => ""));
      if (!res.body) throw new Error("openrouter returned no stream");
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
          if (!line.startsWith("data:")) continue; // ": OPENROUTER PROCESSING" and blank lines
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          let chunk: ChatBody;
          try { chunk = JSON.parse(data) as ChatBody; } catch { continue; }
          if (chunk.error) throw openrouterFailure(Number(chunk.error.code) || 502, chunk);
          const piece = chunk.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        }
      }
    },
  };
}
