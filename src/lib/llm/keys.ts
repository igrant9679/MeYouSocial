import { env } from "@/lib/env";
import { getSetting, invalidateSettingsCache } from "@/lib/settings";

// Resolves an API key for a given provider. Multi-tenant resolution order:
// WorkspaceSetting (the company's own key, set via /admin/api-keys) → global
// Setting row (platform key) → env var. This lets each company bring its own
// keys while workspaces that haven't configured one keep working on the
// platform's key. Caching lives in src/lib/settings.ts (30s, workspace-aware).

type Provider =
  | "anthropic" | "openai" | "google" | "deepseek" | "xai" | "moonshot" | "minimax"
  | "youtube" | "elevenlabs" | "heygen";

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
  heygen:    "api_key:heygen",
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
  heygen:    env.HEYGEN_API_KEY,
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

/**
 * The key providers something in the app actually calls (audit SET-04):
 * Anthropic and Google write; OpenAI makes images and reads them. DeepSeek, xAI,
 * Moonshot and MiniMax are in the catalogue for later and nothing calls them, so
 * the Keys page shows them only to remove a key saved earlier, and a new key for
 * one is refused — a saved key that does nothing reads as working.
 */
export const USED_KEY_PROVIDERS: readonly Provider[] = ["anthropic", "google", "openai"];
export const isUsedKeyProvider = (p: string): boolean => (USED_KEY_PROVIDERS as readonly string[]).includes(p);
