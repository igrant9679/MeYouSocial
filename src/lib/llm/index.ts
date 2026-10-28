import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMResponse, ModelDescriptor } from "./types";
import { mockProvider } from "./mock";
import { createAnthropicProvider } from "./anthropic";
import { createGoogleProvider } from "./google";
import { MODELS, PICKABLE_MODELS, PROVIDER_LABEL, TEXT_PROVIDERS, getModel } from "./models";
import { getApiKey, invalidateKeyCache } from "./keys";
import { meterAi } from "@/lib/usage-meter";

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

/** The global pause, enforced where every generation passes. */
async function refuseIfPaused(req: LLMRequest): Promise<void> {
  if (!req.workspaceId || req.allowWhilePaused) return;
  const { isGloballyPaused, GenerationPausedError } = await import("@/lib/governance");
  if (await isGloballyPaused(req.workspaceId)) throw new GenerationPausedError();
}

export const llm = {
  models: MODELS,
  defaultModel: env.DEFAULT_LLM_MODEL,
  // Every call resolves its model here (audit SET-01): about thirty callers
  // passed a stored choice straight through, so a GPT/DeepSeek/keyless pick
  // wrote mock prose. The reply's `model` is the one that actually ran.
  async complete(req: LLMRequest): Promise<LLMResponse> {
    await refuseIfPaused(req);
    req = { ...req, model: await resolveUsableModel(req.model, req.workspaceId) };
    const p = await selectProvider(req.model, req.workspaceId);
    const out = await p.complete(req);
    // Providers don't set this; the router does. `p` is already the mock when a
    // key is missing or USE_MOCK_LLM is on, so `p.id` is the truth in every case
    // the wrapper didn't already stamp.
    const provider = out.provider ?? p.id;
    await meterAi({ workspaceId: req.workspaceId, action: "ai.text", provider, model: req.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    return { ...out, provider };
  },
  async *stream(req: LLMRequest): AsyncIterable<string> {
    await refuseIfPaused(req);
    req = { ...req, model: await resolveUsableModel(req.model, req.workspaceId) };
    const p = await selectProvider(req.model, req.workspaceId);
    for await (const chunk of p.stream(req)) yield chunk;
    // No token counts on a stream, and a mid-stream fallback isn't visible
    // here — the row says who was asked.
    await meterAi({ workspaceId: req.workspaceId, action: "ai.text", provider: p.id, model: req.model });
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
 *
 * A blank preference means "inherit": the workspace's default, then the
 * platform's. The studio's chains end in "" for that reason — they used to end
 * in "claude-sonnet", so a channel set to "Workspace default" never got it.
 */
export async function resolveUsableModel(preferred: string, workspaceId?: string): Promise<string> {
  if (!preferred) {
    const { db } = await import("@/lib/db");
    const ws = workspaceId ? await db.workspace.findUnique({ where: { id: workspaceId }, select: { defaultModel: true } }) : null;
    preferred = ws?.defaultModel || env.DEFAULT_LLM_MODEL;
  }
  if (env.USE_MOCK_LLM) return preferred;
  const wanted = getModel(preferred);
  const reachable = async (providerId: string) =>
    (providerId === "anthropic" || providerId === "google")
      ? Boolean(await getApiKey(providerId, workspaceId).catch(() => ""))
      : false;

  if (wanted && (await reachable(wanted.provider))) return preferred;

  for (const m of PICKABLE_MODELS) {
    if (await reachable(m.provider)) return m.id;
  }
  return preferred;
}

const providerKeyed = (providerId: string, workspaceId?: string) =>
  TEXT_PROVIDERS.includes(providerId)
    ? getApiKey(providerId as "anthropic" | "google", workspaceId).then(Boolean, () => false)
    : Promise.resolve(false);

export type ModelChoice = ModelDescriptor & { keyed: boolean };

/** What a model picker offers this workspace: models the router can call, each
 *  with whether its provider has a key here (the workspace's or the platform's). */
export async function modelChoices(workspaceId?: string): Promise<ModelChoice[]> {
  const keyed = new Map<string, boolean>();
  for (const p of TEXT_PROVIDERS) keyed.set(p, await providerKeyed(p, workspaceId));
  return PICKABLE_MODELS.map((m) => ({ ...m, keyed: keyed.get(m.provider) ?? false }));
}

/**
 * Why `next` can't be saved as a model choice, or null. Blank (inherit) is
 * always fine, and so is the value already stored — an unrelated save must not
 * fail, or silently change it, because of a choice made before this check.
 */
export async function modelChoiceProblem(next: string | null | undefined, workspaceId: string, current?: string | null): Promise<string | null> {
  if (!next || next === current) return null;
  const m = PICKABLE_MODELS.find((x) => x.id === next);
  if (!m) return `“${next}” isn't a model this app can write with — pick a Claude or Gemini model.`;
  if (!(await providerKeyed(m.provider, workspaceId))) {
    return `${m.label} can't run here: there's no ${PROVIDER_LABEL[m.provider] ?? m.provider} API key. Add one under Settings → Keys, or pick another model.`;
  }
  return null;
}

export type { LLMRequest, LLMResponse, LLMProvider } from "./types";
export type { ModelDescriptor } from "./types";
