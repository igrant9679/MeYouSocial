import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMResponse } from "./types";
import { mockProvider } from "./mock";
import { createAnthropicProvider } from "./anthropic";
import { createGoogleProvider } from "./google";
import { MODELS, getModel } from "./models";
import { getApiKey, invalidateKeyCache } from "./keys";

// Routing layer. Application code uses llm.complete() / llm.stream()
// and never imports a concrete provider. Real providers are wrapped so a network /
// auth / quota / timeout failure transparently falls back to the mock — the app keeps
// working even when an upstream LLM is misconfigured.
//
// Keys come from getApiKey() which prefers a DB Setting row (set via /admin/api-keys)
// and falls back to the env var. Providers are cached per-key so a rotation in the
// admin UI takes effect on the next request without a redeploy.

const providerCache = new Map<string, LLMProvider>();

async function getProvider(providerId: string, workspaceId?: string): Promise<LLMProvider> {
  const key = (providerId === "anthropic" || providerId === "google")
    ? await getApiKey(providerId, workspaceId)
    : "";
  const cacheKey = `${providerId}:${key ? hash(key) : "none"}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;
  let provider: LLMProvider;
  switch (providerId) {
    case "anthropic":
      if (!key) { provider = mockProvider; break; }
      provider = wrapWithFallback(createAnthropicProvider(key), "anthropic");
      break;
    case "google":
      if (!key) { provider = mockProvider; break; }
      provider = wrapWithFallback(createGoogleProvider(key), "google");
      break;
    // Other providers go here as we wire them up (openai, deepseek, xai, moonshot, minimax).
    default:
      provider = mockProvider;
  }
  providerCache.set(cacheKey, provider);
  return provider;
}

// Cheap stable identifier for an opaque key string, used as a cache key.
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `h${h}`;
}

/**
 * Wrap a real provider so transient errors (timeouts, 401, 429, network) silently fall back
 * to the mock provider. Also enforces a hard timeout so a hung upstream can't lock up a user.
 */
function wrapWithFallback(real: LLMProvider, providerId: string): LLMProvider {
  const TIMEOUT_MS = 45_000;

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${providerId} timed out after ${ms}ms`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  return {
    id: real.id,
    supports: real.supports,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      try {
        // req.timeoutMs: long-form callers (article drafting) need more than
        // 45s — see the field's doc for the incident that proved it.
        const out = await withTimeout(real.complete(req), req.timeoutMs ?? TIMEOUT_MS);
        return { ...out, provider: providerId };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[llm] ${providerId}.complete failed → falling back to mock:`, e instanceof Error ? e.message : e);
        // ⚠ Stamped "mock", not `providerId`. This branch is exactly the case a
        // caller must be able to detect: the request LOOKS like it went to a
        // real provider and the prose comes back fluent either way.
        const fallback = await mockProvider.complete(req);
        return { ...fallback, provider: "mock" };
      }
    },
    async *stream(req: LLMRequest) {
      try {
        const iter = real.stream(req)[Symbol.asyncIterator]();
        const first = await withTimeout(iter.next(), req.timeoutMs ?? TIMEOUT_MS);
        if (first.done) return;
        yield first.value;
        let next = await iter.next();
        while (!next.done) { yield next.value; next = await iter.next(); }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[llm] ${providerId}.stream failed → falling back to mock:`, e instanceof Error ? e.message : e);
        for await (const chunk of mockProvider.stream(req)) yield chunk;
      }
    },
  };
}

async function selectProvider(model: string, workspaceId?: string): Promise<LLMProvider> {
  if (env.USE_MOCK_LLM) return mockProvider;
  const descriptor = getModel(model);
  if (!descriptor) return mockProvider;
  return getProvider(descriptor.provider, workspaceId);
}

export const llm = {
  models: MODELS,
  defaultModel: env.DEFAULT_LLM_MODEL,
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const p = await selectProvider(req.model, req.workspaceId);
    const out = await p.complete(req);
    // Providers don't set this; the router does. `p` is already the mock when a
    // key is missing or USE_MOCK_LLM is on, so `p.id` is the truth in every case
    // the wrapper didn't already stamp.
    return { ...out, provider: out.provider ?? p.id };
  },
  async *stream(req: LLMRequest): AsyncIterable<string> {
    const p = await selectProvider(req.model, req.workspaceId);
    for await (const chunk of p.stream(req)) yield chunk;
  },
  invalidateKeyCache,
};

/**
 * Pick a model this workspace can actually reach.
 *
 * ⚠ A model id whose provider has no key resolves to the MOCK, silently. That
 * is fine for a background job (the output is labelled) but wrong for a button
 * someone just pressed: LSI Media has a Google key and no Anthropic key, so a
 * workspace-level call falling back to env's `claude-sonnet` produced mock prose
 * on an account that is fully configured. Found by probing production, not by
 * reading the code — from the outside it looked like the feature working.
 *
 * Order: the caller's preference (channel → workspace → env), then, only if
 * that provider has no key, the first model whose provider does. Returns the
 * preference unchanged when nothing is reachable, so the caller still gets a
 * clearly-labelled mock rather than a hidden substitution.
 */
export async function resolveUsableModel(preferred: string, workspaceId?: string): Promise<string> {
  if (env.USE_MOCK_LLM) return preferred;
  const wanted = getModel(preferred);
  const reachable = async (providerId: string) =>
    (providerId === "anthropic" || providerId === "google")
      ? Boolean(await getApiKey(providerId, workspaceId).catch(() => ""))
      : false;

  if (wanted && (await reachable(wanted.provider))) return preferred;

  for (const m of MODELS) {
    if (m.provider === "mock") continue;
    if (await reachable(m.provider)) return m.id;
  }
  return preferred;
}

export type { LLMRequest, LLMResponse, LLMProvider } from "./types";
export type { ModelDescriptor } from "./types";
