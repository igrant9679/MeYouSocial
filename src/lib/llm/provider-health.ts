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
