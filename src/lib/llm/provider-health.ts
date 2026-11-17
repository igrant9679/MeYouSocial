import { getSetting, setWorkspaceSetting } from "@/lib/settings";
import { getModel } from "./models";

// A provider that REFUSES a workspace's calls — out of credits, over its quota,
// a rejected key — is something a person must fix, and the router's fallback
// hides it: every call quietly becomes a placeholder that the guards then
// refuse to store, so the engine just stops making things. Found 2026-10-28:
// LSI's Google credits ran out ~26 Oct (402 "prepayment credits are
// depleted") and the only trace was `ai.text/mock` rows in Usage.
//
// The router records the refusal per workspace and provider; a later success
// clears it; the Inbox names it (lib/home.ts). Timeouts and one-off errors
// are not refusals and aren't recorded.
//
// "model" (2026-11-17): the provider no longer serves the model that was asked
// for — a 404. Anthropic retired claude-opus-4-1 on 2026-08-05 and the app went
// on "answering" with placeholders for three months, because a 404 was none of
// the three kinds below and so was never recorded. It carries WHICH model (the
// app's own id), and only a success on that same model clears it: a workspace
// on a working model with one channel on a retired one would otherwise have its
// card appear and vanish with every other call.

export type RefusalKind = "credits" | "quota" | "key" | "model";
export type ProviderRefusal = { provider: string; kind: RefusalKind; message: string; since: string; at: string; model?: string };

const KEY = (provider: string) => `llm:refusal:${provider}`;
const PROVIDERS = ["anthropic", "google"] as const;

export function refusalKind(message: string): RefusalKind | null {
  // First, because it is the most specific: Anthropic says `404 … not_found_error … model: <id>`,
  // Google `404 … is not found for API version …` or `… no longer available to new users` (status NOT_FOUND).
  if (/\b404\b|not_found_error|\bNOT_FOUND\b|no longer available|is not found for API version/i.test(message)) return "model";
  if (/\b402\b|prepayment credits|credit balance|insufficient.{0,20}credit|billing/i.test(message)) return "credits";
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(message)) return "quota";
  if (/\b401\b|\b403\b|PERMISSION_DENIED|API key not valid|invalid.{0,10}api.?key|authentication_error/i.test(message)) return "key";
  return null;
}

function read(raw: string): ProviderRefusal | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProviderRefusal;
  } catch {
    return null;
  }
}

/** `model` is the app's own id for what was asked ("claude-opus") — kept only for a "model" refusal. */
export async function recordProviderRefusal(workspaceId: string | undefined, provider: string, message: string, model?: string): Promise<void> {
  if (!workspaceId) return;
  const kind = refusalKind(message);
  if (!kind) return;
  const named = kind === "model" ? model : undefined;
  const prev = read(await getSetting(KEY(provider), workspaceId));
  // At most one write every ten minutes per workspace and provider.
  if (prev && prev.kind === kind && Date.now() - Date.parse(prev.at) < 10 * 60_000) return;
  const now = new Date().toISOString();
  const clean = message.replace(/AIza[\w-]+|AQ\.[\w.-]+|sk-ant-[\w-]+/g, "[key]").replace(/\s+/g, " ").slice(0, 300);
  // "Since" survives a repeat. Where a model is involved it does only for the same model again.
  const carries = prev && (kind === "model" || prev.kind === "model" ? prev.kind === kind && prev.model === named : true);
  await setWorkspaceSetting(workspaceId, KEY(provider), JSON.stringify({ provider, kind, message: clean, since: carries ? prev.since : now, at: now, ...(named ? { model: named } : {}) }));
}

/** A success clears the provider's refusal — except a "model" one, which only a success on THAT model clears. */
export async function clearProviderRefusal(workspaceId: string | undefined, provider: string, model?: string): Promise<void> {
  if (!workspaceId) return;
  const prev = read(await getSetting(KEY(provider), workspaceId));
  if (!prev) return;
  if (prev.kind === "model" && prev.model && prev.model !== model) return;
  await setWorkspaceSetting(workspaceId, KEY(provider), "");
}

/** Longer than the engine's 30-minute sweep, so a job that fails every sweep keeps its card up without a gap. */
const MODEL_REFUSAL_FRESH_MS = 45 * 60_000;

/**
 * Is a "model" refusal still worth telling anyone? The fix for a retired model
 * is to choose another — after which nothing calls the old one, so no success
 * ever comes to clear the record. It counts while it failed in the last 45
 * minutes, or while that model is still what the workspace (its own default, or
 * the platform's when it has none) or one of its channels is set to. The other
 * three kinds are never aged out here — unchanged.
 */
async function stillMatters(r: ProviderRefusal, workspaceId: string): Promise<boolean> {
  if (r.kind !== "model") return true;
  if (Date.now() - Date.parse(r.at) < MODEL_REFUSAL_FRESH_MS) return true;
  if (!r.model) return false;
  const { db } = await import("@/lib/db");
  const { env } = await import("@/lib/env");
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { defaultModel: true } });
  if ((ws?.defaultModel || env.DEFAULT_LLM_MODEL) === r.model) return true;
  return (await db.channel.count({ where: { workspaceId, defaultModel: r.model } })) > 0;
}

export async function providerRefusals(workspaceId: string): Promise<ProviderRefusal[]> {
  const rows = await Promise.all(PROVIDERS.map((p) => getSetting(KEY(p), workspaceId).then(read, () => null)));
  const found = rows.filter((r): r is ProviderRefusal => r !== null);
  // If the check itself fails, show the card: a wrong card beats a silent placeholder.
  const kept = await Promise.all(found.map((r) => stillMatters(r, workspaceId).catch(() => true)));
  return found.filter((_, i) => kept[i]);
}

const PROVIDER_NAME: Record<string, string> = { anthropic: "Anthropic", google: "Google" };
const PROVIDER_CONSOLE: Record<string, string> = { anthropic: "console.anthropic.com", google: "ai.studio/projects" };

/** The first provider refusing this workspace, described — or null when none is (a plain timeout/error). */
export async function refusalNote(workspaceId: string): Promise<string | null> {
  const r = (await providerRefusals(workspaceId).catch(() => []))[0];
  return r ? describeRefusal(r) : null;
}

/** "Claude Opus" for a recorded "claude-opus"; "a model this workspace uses" when the record names none. */
export function refusedModelLabel(r: Pick<ProviderRefusal, "model">): string {
  return (r.model && getModel(r.model)?.label) || "a model this workspace uses";
}

/** "Google is refusing this workspace's AI calls — its prepaid credits are used up. Fix it at …" — one place for the wording. */
export function describeRefusal(r: Pick<ProviderRefusal, "provider" | "kind" | "model">): string {
  const name = PROVIDER_NAME[r.provider] ?? r.provider;
  if (r.kind === "model") {
    return `${name} no longer offers ${refusedModelLabel(r)} — every call to it gets a placeholder. Pick another model under Settings → Workspace, and on any channel, article or script set to it.`;
  }
  const why = r.kind === "credits" ? "its prepaid credits are used up" : r.kind === "quota" ? "it's over its rate or quota limit" : "it rejected the key";
  const fix = r.kind === "key"
    ? "Check the key under Settings → Keys."
    : `Fix it at ${PROVIDER_CONSOLE[r.provider] ?? "the provider's console"}, or pick another provider's model under Settings → Workspace.`;
  return `${name} is refusing this workspace's AI calls — ${why}. ${fix}`;
}

/**
 * Why a call came back as the placeholder (tracker #25): "no working AI key"
 * was said even when a key was there and its provider was REFUSING — LSI's
 * Google credits ran out, and every question got the same wrong answer. Named
 * refusal first, then no key at all, then a provider that just didn't answer.
 */
export async function whyNoAiReply(workspaceId: string | undefined): Promise<string> {
  if (workspaceId) {
    const refusals = await providerRefusals(workspaceId).catch(() => []);
    if (refusals.length) return refusals.map(describeRefusal).join(" ");
  }
  const { getApiKey } = await import("./keys");
  const keyed = await Promise.all(PROVIDERS.map((p) => getApiKey(p, workspaceId).then(Boolean, () => false)));
  if (!keyed.some(Boolean)) return "This workspace has no AI key — add one under Settings → Keys.";
  return "The AI provider didn't answer just now (it timed out or returned an error) — try again in a minute.";
}
