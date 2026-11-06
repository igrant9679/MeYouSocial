import { getSetting, setWorkspaceSetting } from "@/lib/settings";

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

export type RefusalKind = "credits" | "quota" | "key";
export type ProviderRefusal = { provider: string; kind: RefusalKind; message: string; since: string; at: string };

const KEY = (provider: string) => `llm:refusal:${provider}`;
const PROVIDERS = ["anthropic", "google"] as const;

export function refusalKind(message: string): RefusalKind | null {
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

export async function recordProviderRefusal(workspaceId: string | undefined, provider: string, message: string): Promise<void> {
  if (!workspaceId) return;
  const kind = refusalKind(message);
  if (!kind) return;
  const prev = read(await getSetting(KEY(provider), workspaceId));
  // At most one write every ten minutes per workspace and provider.
  if (prev && prev.kind === kind && Date.now() - Date.parse(prev.at) < 10 * 60_000) return;
  const now = new Date().toISOString();
  const clean = message.replace(/AIza[\w-]+|AQ\.[\w.-]+|sk-ant-[\w-]+/g, "[key]").replace(/\s+/g, " ").slice(0, 300);
  await setWorkspaceSetting(workspaceId, KEY(provider), JSON.stringify({ provider, kind, message: clean, since: prev?.since ?? now, at: now }));
}

export async function clearProviderRefusal(workspaceId: string | undefined, provider: string): Promise<void> {
  if (!workspaceId) return;
  if (await getSetting(KEY(provider), workspaceId)) await setWorkspaceSetting(workspaceId, KEY(provider), "");
}

export async function providerRefusals(workspaceId: string): Promise<ProviderRefusal[]> {
  const rows = await Promise.all(PROVIDERS.map((p) => getSetting(KEY(p), workspaceId).then(read, () => null)));
  return rows.filter((r): r is ProviderRefusal => r !== null);
}

const PROVIDER_NAME: Record<string, string> = { anthropic: "Anthropic", google: "Google" };
const PROVIDER_CONSOLE: Record<string, string> = { anthropic: "console.anthropic.com", google: "ai.studio/projects" };

/** "Google is refusing this workspace's AI calls — its prepaid credits are used up. Fix it at …" — one place for the wording. */
export function describeRefusal(r: Pick<ProviderRefusal, "provider" | "kind">): string {
  const name = PROVIDER_NAME[r.provider] ?? r.provider;
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
