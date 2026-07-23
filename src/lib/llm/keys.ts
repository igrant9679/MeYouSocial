import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Resolves an API key for a given provider, preferring DB-stored settings
// (set via /admin/api-keys) over the corresponding env var. This lets an admin
// paste a key in-app without needing Railway access.
//
// We cache the resolved value for 30 seconds so we don't hammer the DB on every
// LLM request. The admin save action calls invalidateKeyCache() to force a fresh
// read immediately after an update.

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

const CACHE_TTL_MS = 30_000;
const cache = new Map<Provider, { value: string; expires: number }>();

export async function getApiKey(provider: Provider): Promise<string> {
  const cached = cache.get(provider);
  if (cached && cached.expires > Date.now()) return cached.value;
  let value = "";
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY[provider] } });
    value = row?.value ?? "";
  } catch {
    // DB unavailable — fall through to env
  }
  if (!value) value = ENV_KEY[provider] ?? "";
  cache.set(provider, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export function invalidateKeyCache() {
  cache.clear();
}

export const KEY_PROVIDERS: Provider[] = ["anthropic", "openai", "google", "deepseek", "xai", "moonshot", "minimax"];
export type KeyProvider = Provider;
