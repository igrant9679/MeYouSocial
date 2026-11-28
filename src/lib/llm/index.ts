import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMResponse, ModelDescriptor } from "./types";
import { mockProvider } from "./mock";
import { createAnthropicProvider } from "./anthropic";
import { createGoogleProvider } from "./google";
import { createDeepSeekProvider } from "./deepseek";
import { createOpenRouterProvider, defaultOpenRouterSlug, getOpenRouterModels, lookupOpenRouterModel } from "./openrouter";
import { canAnswerStructured, isOpenRouterModel, openrouterModelId, openrouterSlug, pickerModels } from "./openrouter-catalog";
import { LIGHT_ONLY_MODELS, MODELS, PICKABLE_MODELS, PLATFORM_DEFAULT_MODEL_KEY, PROVIDER_LABEL, TEXT_PROVIDERS, getModel, isLightOnlyModel } from "./models";
import { TIER_SETTING_KEYS, isTier, tierModel, tierOf, type Tier, type TierSettings } from "./tiers";
import { getApiKey, invalidateKeyCache } from "./keys";
import { getSetting } from "@/lib/settings";
import { meterAi } from "@/lib/usage-meter";
import { clearProviderRefusal, recordProviderRefusal } from "./provider-health";

// Routing layer. Application code uses llm.complete() / llm.stream()
// and never imports a concrete provider. Real providers are wrapped so a network /
// auth / quota / timeout failure transparently falls back to the mock — the app keeps
// working even when an upstream LLM is misconfigured.
//
// Keys come from getApiKey() which prefers a DB Setting row (set via /admin/api-keys)
// and falls back to the env var. Providers are cached per-key so a rotation in the
// admin UI takes effect on the next request without a redeploy.

const providerCache = new Map<string, LLMProvider>();

/** The providers the router can call with a key. */
const KEYED = ["anthropic", "google", "deepseek", "openrouter"] as const;
type Keyed = (typeof KEYED)[number];
const isKeyed = (p: string): p is Keyed => (KEYED as readonly string[]).includes(p);

async function getProvider(providerId: string, workspaceId?: string): Promise<LLMProvider> {
  const key = isKeyed(providerId) ? await getApiKey(providerId, workspaceId) : "";
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
    case "deepseek":
      if (!key) { provider = mockProvider; break; }
      provider = wrapWithFallback(createDeepSeekProvider(key), "deepseek");
      break;
    case "openrouter":
      if (!key) { provider = mockProvider; break; }
      provider = wrapWithFallback(createOpenRouterProvider(key), "openrouter");
      break;
    // Other providers go here as we wire them up (openai, xai, moonshot, minimax).
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
        await clearProviderRefusal(req.workspaceId, providerId, req.model).catch(() => {});
        return { ...out, provider: providerId };
      } catch (e) {
        console.warn(`[llm] ${providerId}.complete failed → falling back to mock:`, e instanceof Error ? e.message : e);
        // Out of credits, over quota, a rejected key, or a model the provider
        // no longer serves: recorded for the Inbox.
        await recordProviderRefusal(req.workspaceId, providerId, e instanceof Error ? e.message : String(e), req.model).catch(() => {});
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
        console.warn(`[llm] ${providerId}.stream failed → falling back to mock:`, e instanceof Error ? e.message : e);
        if (req.answeredBy) req.answeredBy.provider = "mock";
        await recordProviderRefusal(req.workspaceId, providerId, e instanceof Error ? e.message : String(e), req.model).catch(() => {});
        for await (const chunk of mockProvider.stream(req)) yield chunk;
      }
    },
  };
}

async function selectProvider(model: string, workspaceId?: string): Promise<LLMProvider> {
  if (env.USE_MOCK_LLM) return mockProvider;
  const descriptor = getModel(model);
  if (!descriptor) return mockProvider;
  // ⚠ A light-only provider (DeepSeek) is never called for a workspace whose
  // admin hasn't allowed it — whatever a caller or a stored row names. Where a
  // workspace's text is processed is that admin's decision (lib/llm/tiers.ts).
  if (isLightOnlyModel(model) && !(await lightOnlyAllowed(workspaceId))) return mockProvider;
  return getProvider(descriptor.provider, workspaceId);
}

/**
 * The global pause, enforced where every generation passes — and a hold (lib/workspace-hold.ts),
 * which `allowWhilePaused` never lifts: a trial out of allowance stays out of it.
 */
async function refuseIfPaused(req: LLMRequest): Promise<void> {
  if (!req.workspaceId) return;
  const { refuseGenerationIfStopped } = await import("@/lib/governance");
  await refuseGenerationIfStopped(req.workspaceId, { allowWhilePaused: req.allowWhilePaused });
}

export const llm = {
  models: MODELS,
  defaultModel: env.DEFAULT_LLM_MODEL,
  // Every call resolves its model here (audit SET-01): about thirty callers
  // passed a stored choice straight through, so a GPT/DeepSeek/keyless pick
  // wrote mock prose. The reply's `model` is the one that actually ran.
  async complete(req: LLMRequest): Promise<LLMResponse> {
    await refuseIfPaused(req);
    req = { ...req, model: await resolveUsableModel(req.model, req.workspaceId, req.purpose) };
    const p = await selectProvider(req.model, req.workspaceId);
    const out = await p.complete(req);
    // Providers don't set this; the router does. `p` is already the mock when a
    // key is missing or USE_MOCK_LLM is on, so `p.id` is the truth in every case
    // the wrapper didn't already stamp.
    const provider = out.provider ?? p.id;
    await meterAi({ workspaceId: req.workspaceId, action: "ai.text", provider, model: req.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, purpose: req.purpose, costUsd: provider === "mock" ? null : out.costUsd });
    return { ...out, provider };
  },
  async *stream(req: LLMRequest): AsyncIterable<string> {
    await refuseIfPaused(req);
    req = { ...req, model: await resolveUsableModel(req.model, req.workspaceId, req.purpose) };
    const p = await selectProvider(req.model, req.workspaceId);
    if (req.answeredBy) Object.assign(req.answeredBy, { provider: p.id, model: req.model });
    for await (const chunk of p.stream(req)) yield chunk;
    // No token counts on a stream, and a mid-stream fallback isn't visible
    // here — the row says who was asked.
    await meterAi({ workspaceId: req.workspaceId, action: "ai.text", provider: p.id, model: req.model, purpose: req.purpose });
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
 *
 * MODEL TIERS (2026-11-17, lib/llm/tiers.ts): an INHERITED model, for a call
 * that says what it is for (`purpose`), becomes the model of that job's tier
 * when the workspace has tiers on. ⚠ Only a blank preference is tiered — an
 * article's, a script's or a channel's own model is a person's choice and is
 * returned as it is. That is why no call site may pass the workspace's default
 * as its model (scripts/check-model-callers.mts fails the build if one does):
 * the router could not tell it from a choice, and the job would never be tiered.
 * A tier's model that can't be reached here falls back to the default, never to
 * a placeholder.
 */
export async function resolveUsableModel(preferred: string, workspaceId?: string, purpose?: string): Promise<string> {
  // A light-only model (DeepSeek) is never one article's, script's or channel's choice.
  if (preferred && isLightOnlyModel(preferred)) preferred = "";
  const inherited = !preferred;
  if (inherited) {
    const { db } = await import("@/lib/db");
    const ws = workspaceId ? await db.workspace.findUnique({ where: { id: workspaceId }, select: { defaultModel: true } }) : null;
    preferred = ws?.defaultModel || (await inheritedDefault(workspaceId));
    if (isLightOnlyModel(preferred)) preferred = env.DEFAULT_LLM_MODEL;
  }
  let base = preferred;
  if (!env.USE_MOCK_LLM && !(await modelReachable(preferred, workspaceId))) {
    base = (await firstReachable(workspaceId)) ?? preferred;
  }
  if (!inherited || !workspaceId || !purpose) return base;
  const s = await tierSettings(workspaceId);
  if (!s.on) return base;
  return tierRun(tierOf(purpose, s.elsie), s, base, workspaceId);
}

/**
 * The platform's default model (Settings → Keys → OpenRouter, operator only): the global row,
 * or "" while it stays on today's default. A stored value naming a light-only model is ignored.
 */
export async function platformDefaultSetting(): Promise<string> {
  const v = (await getSetting(PLATFORM_DEFAULT_MODEL_KEY).catch(() => "")).trim();
  return v && getModel(v) && !isLightOnlyModel(v) ? v : "";
}

/**
 * What a workspace with no model of its own inherits (2026-11-27, the owner's "a platform
 * setting chooses the default provider for workspaces with no AI choice or key"): the
 * platform's default when the operator set one AND the workspace has no text key of its own —
 * a workspace that brought its own Anthropic or Google key keeps writing on it, at its cost,
 * never moved onto the shared key. Otherwise today's default (`DEFAULT_LLM_MODEL`).
 */
export async function inheritedDefault(workspaceId?: string): Promise<string> {
  const platform = await platformDefaultSetting();
  if (!platform || (workspaceId && (await hasOwnTextKey(workspaceId)))) return env.DEFAULT_LLM_MODEL;
  return platform;
}

const OWN_KEY_TTL_MS = 30_000;
const ownKeyCache = new Map<string, { own: boolean; expires: number }>();
const WRITER_KEYS = ["api_key:anthropic", "api_key:google", "api_key:openrouter"];

/**
 * Does the workspace have one of these keys of its own — saved, or shared with it by another
 * of its admins' workspaces? Never the platform's. Cached 30 s per workspace and key set.
 */
async function hasOwnKey(workspaceId: string, keys: readonly string[]): Promise<boolean> {
  const ck = `${workspaceId}:${keys.join(",")}`;
  const hit = ownKeyCache.get(ck);
  if (hit && hit.expires > Date.now()) return hit.own;
  const { db } = await import("@/lib/db");
  const [rows, shares] = await Promise.all([
    db.workspaceSetting.count({ where: { workspaceId, key: { in: [...keys] }, NOT: { value: "" } } }),
    db.keyShare.count({ where: { toWorkspaceId: workspaceId, key: { in: [...keys] }, from: { deletedAt: null } } }),
  ]).catch(() => [0, 0]);
  const own = rows + shares > 0;
  ownKeyCache.set(ck, { own, expires: Date.now() + OWN_KEY_TTL_MS });
  return own;
}

/** A writing key of the workspace's own (Anthropic, Google or OpenRouter) — not the platform's. */
const hasOwnTextKey = (workspaceId: string) => hasOwnKey(workspaceId, WRITER_KEYS);

/**
 * When the preferred model can't be reached here (no key for its provider): the platform's
 * default first, then the first pickable model with a key, then OpenRouter's default model —
 * ⚠ only on the workspace's OWN OpenRouter key (or one shared with it). The platform's shared
 * OpenRouter key runs a workspace's AI only when the workspace picked an OpenRouter model or
 * the operator switched the platform default: "it stays on today's default until the owner
 * switches it". Null = nothing reachable (the caller keeps its preference, so the placeholder
 * is labelled rather than hidden).
 */
async function firstReachable(workspaceId?: string): Promise<string | null> {
  const platform = await platformDefaultSetting();
  if (platform && (await modelReachable(platform, workspaceId))) return platform;
  for (const m of PICKABLE_MODELS) {
    if (await providerReachable(m.provider, workspaceId)) return m.id;
  }
  if (workspaceId && (await hasOwnKey(workspaceId, ["api_key:openrouter"]))) return openrouterModelId(await defaultOpenRouterSlug());
  return null;
}

/** Can this workspace's calls reach the provider: a key — and, for a light-only one, its admin's say-so. */
async function providerReachable(providerId: string, workspaceId?: string): Promise<boolean> {
  if (!isKeyed(providerId)) return false;
  return Boolean(await getApiKey(providerId, workspaceId).catch(() => ""));
}

async function modelReachable(model: string, workspaceId?: string): Promise<boolean> {
  const m = getModel(model);
  if (!m) return false;
  if (isLightOnlyModel(model) && !(await lightOnlyAllowed(workspaceId))) return false;
  // With the mock on nothing is called, so every listed model "runs".
  return env.USE_MOCK_LLM ? true : providerReachable(m.provider, workspaceId);
}

/** Has this workspace's admin allowed the light-only providers (DeepSeek)? Never without a workspace. */
async function lightOnlyAllowed(workspaceId?: string): Promise<boolean> {
  return workspaceId ? (await tierSettings(workspaceId)).deepseek : false;
}

/** A workspace's tier dials (Settings → Workspace). Each read is cached 30 s by lib/settings. */
export async function tierSettings(workspaceId: string): Promise<TierSettings> {
  const [on, light, best, elsie, deepseek] = await Promise.all(TIER_SETTING_KEYS.map((k) => getSetting(k, workspaceId).catch(() => "")));
  return { on: on === "on", light, best, elsie: isTier(elsie) ? elsie : "standard", deepseek: deepseek === "on" };
}

/** The model a job of `tier` runs on here: the tier's pick (or automatic model) when it can be reached, else the default. */
async function tierRun(tier: Tier, s: TierSettings, base: string, workspaceId: string): Promise<string> {
  if (tier === "standard") return base;
  const want = tierModel(tier, s, base);
  if (!want || want === base) return base;
  // A light-only model is the Light tier's and nobody else's.
  if (tier !== "light" && isLightOnlyModel(want)) return base;
  return (await modelReachable(want, workspaceId)) ? want : base;
}

/**
 * What each tier runs in this workspace right now — whether or not tiers are
 * on — for Settings and Usage. `standard` is the usable default model.
 */
export async function tierRuns(workspaceId: string): Promise<{ settings: TierSettings } & Record<Tier, string>> {
  const [settings, standard] = await Promise.all([tierSettings(workspaceId), resolveUsableModel("", workspaceId)]);
  const [light, best] = await Promise.all([tierRun("light", settings, standard, workspaceId), tierRun("best", settings, standard, workspaceId)]);
  return { settings, standard, light, best };
}

/**
 * What a picker's "inherit" option should say writes: the default model's name —
 * or, with tiers on, that each job uses its own tier's model (naming one model
 * there would be wrong for most of the jobs).
 */
export async function inheritedModelNote(workspaceId: string): Promise<string> {
  const { settings, standard } = await tierRuns(workspaceId);
  return settings.on ? "each job's tier model" : (getModel(standard)?.label ?? standard);
}

const providerKeyed = (providerId: string, workspaceId?: string) =>
  isKeyed(providerId) ? getApiKey(providerId, workspaceId).then(Boolean, () => false) : Promise.resolve(false);

export type ModelChoice = ModelDescriptor & { keyed: boolean };

/** What a model picker offers this workspace: models the router can call, each
 *  with whether its provider has a key here (the workspace's or the platform's). */
export async function modelChoices(workspaceId?: string): Promise<ModelChoice[]> {
  const keyed = new Map<string, boolean>();
  for (const p of TEXT_PROVIDERS) keyed.set(p, await providerKeyed(p, workspaceId));
  return [...PICKABLE_MODELS.map((m) => ({ ...m, keyed: keyed.get(m.provider) ?? false })), ...(await openRouterChoices(workspaceId))];
}

/**
 * OpenRouter's models for a picker (2026-11-27): only while an OpenRouter key resolves here —
 * the workspace's own, one shared with it, or the platform's shared key — and only those that
 * can give a structured answer (lib/llm/openrouter-catalog.ts says why every picker needs that).
 * The newest Claude Sonnet first, each with OpenRouter's listed price. An unreadable list = none.
 */
export async function openRouterChoices(workspaceId?: string): Promise<ModelChoice[]> {
  if (!(await providerKeyed("openrouter", workspaceId))) return [];
  const list = await getOpenRouterModels();
  return pickerModels(list.models).map((m) => ({ ...getModel(openrouterModelId(m.slug))!, keyed: true }));
}

/** The Light tier's picker: every pickable model, plus the light-only ones (DeepSeek) with whether a key is saved. */
export async function lightModelChoices(workspaceId: string): Promise<ModelChoice[]> {
  const extra = await Promise.all(LIGHT_ONLY_MODELS.map(async (m) => ({ ...m, keyed: await providerKeyed(m.provider, workspaceId) })));
  return [...(await modelChoices(workspaceId)), ...extra];
}

/**
 * Why `next` can't be saved as a tier's model, or null. Blank (automatic) and
 * the stored value are always fine. A light-only model needs the Light tier, the
 * admin's allowance (`allowed` — what is being saved now) and a key.
 */
export async function tierModelProblem(tier: Exclude<Tier, "standard">, next: string, workspaceId: string, current: string, allowed: boolean): Promise<string | null> {
  if (!next) return null;
  if (!isLightOnlyModel(next)) return modelChoiceProblem(next, workspaceId, current);
  const label = getModel(next)?.label ?? next;
  if (tier !== "light") return `${label} can only be the Light model.`;
  if (!allowed) return `${label} can only be used after you tick “Allow DeepSeek for this workspace”.`;
  if (!(await providerKeyed("deepseek", workspaceId))) return `${label} can't run here: there's no DeepSeek API key. Add one under Settings → Keys first.`;
  return null;
}

/**
 * Why `next` can't be saved as a model choice, or null. Blank (inherit) is
 * always fine, and so is the value already stored — an unrelated save must not
 * fail, or silently change it, because of a choice made before this check.
 */
export async function modelChoiceProblem(next: string | null | undefined, workspaceId: string, current?: string | null): Promise<string | null> {
  if (!next || next === current) return null;
  if (isOpenRouterModel(next)) return openRouterChoiceProblem(next, workspaceId);
  const m = PICKABLE_MODELS.find((x) => x.id === next);
  if (!m) return `“${next}” isn't a model this app can write with — pick a Claude, Gemini or OpenRouter model.`;
  if (!(await providerKeyed(m.provider, workspaceId))) {
    return `${m.label} can't run here: there's no ${PROVIDER_LABEL[m.provider] ?? m.provider} API key. Add one under Settings → Keys, or pick another model.`;
  }
  return null;
}

/**
 * Why an OpenRouter model can't be saved here, or null: no OpenRouter key resolves, OpenRouter
 * no longer lists it, or it can't give a structured answer. When the list can't be read nothing
 * can be said about the model, so it is accepted and OpenRouter answers the first call.
 */
async function openRouterChoiceProblem(next: string, workspaceId: string): Promise<string | null> {
  const label = getModel(next)?.label ?? next;
  if (!(await providerKeyed("openrouter", workspaceId))) {
    return `${label} can't run here: there's no OpenRouter key. Add one under Settings → Keys, or pick another model.`;
  }
  const { known, model } = await lookupOpenRouterModel(openrouterSlug(next));
  if (known && !model) return `OpenRouter doesn't list “${openrouterSlug(next)}” any more — pick another model.`;
  if (model && !canAnswerStructured(model)) {
    return `${label} can't give the structured answers parts of Publisher need (it takes neither tools nor JSON output) — pick another model.`;
  }
  return null;
}

export type { LLMRequest, LLMResponse, LLMProvider } from "./types";
export type { ModelDescriptor } from "./types";
