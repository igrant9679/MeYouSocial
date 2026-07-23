import { env } from "@/lib/env";
import { getSetting, invalidateSettingsCache } from "@/lib/settings";

// Resolves an API key for a given provider. Multi-tenant resolution order:
// WorkspaceSetting (the company's own key, set via /admin/api-keys) → global
// Setting row (platform key) → env var. This lets each company bring its own
// keys while workspaces that haven't configured one keep working on the
// platform's key. Caching lives in src/lib/settings.ts (30s, workspace-aware).

type Provider =
  | "anthropic" | "openai" | "google" | "deepseek" | "xai" | "moonshot" | "minimax"
  | "youtube" | "elevenlabs";

const SETTING_KEY: Record<Provider, string> = {
  anthropic: "api_key:anthropic",
  openai:    "api_key:openai",
  google:    "api_key:google",
  deepseek:  "api_key:deepseek",
  xai:       "api_key:xai",
  moonshot:  "api_key:moonshot",
  minimax:   "api_key:minimax",
  youtube:   "api_key:youtube",
  elevenlabs: "api_key:elevenlabs",
};

const ENV_KEY: Record<Provider, string> = {
  anthropic: env.ANTHROPIC_API_KEY,
  openai:    env.OPENAI_API_KEY,
  google:    env.GOOGLE_GENAI_API_KEY,
  deepseek:  env.DEEPSEEK_API_KEY,
  xai:       env.XAI_API_KEY,
  moonshot:  env.MOONSHOT_API_KEY,
  minimax:   env.MINIMAX_API_KEY,
  youtube:   process.env.YOUTUBE_API_KEY ?? "",
  elevenlabs: process.env.ELEVENLABS_API_KEY ?? "",
};

export async function getApiKey(provider: Provider, workspaceId?: string | null): Promise<string> {
  const value = await getSetting(SETTING_KEY[provider], workspaceId);
  return value || (ENV_KEY[provider] ?? "");
}

export function invalidateKeyCache() {
  invalidateSettingsCache();
}

export const KEY_PROVIDERS: Provider[] = ["anthropic", "openai", "google", "deepseek", "xai", "moonshot", "minimax"];
export type KeyProvider = Provider;
