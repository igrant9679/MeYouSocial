// Centralized env access. Coerces types and exposes USE_MOCK_* flags.

function str(v: string | undefined, fallback = ""): string {
  return v ?? fallback;
}
function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v.toLowerCase() === "yes";
}
function num(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const env = {
  NODE_ENV: str(process.env.NODE_ENV, "development"),
  APP_URL: str(process.env.APP_URL, "http://localhost:3000"),
  APP_NAME: str(process.env.APP_NAME, "MeYouSocial"),
  BOOTSTRAP_ADMIN_EMAIL: str(process.env.BOOTSTRAP_ADMIN_EMAIL).toLowerCase(),

  DATABASE_URL: str(process.env.DATABASE_URL),

  AUTH_SECRET: str(process.env.AUTH_SECRET, "dev-only-not-secret"),
  AUTH_URL: str(process.env.AUTH_URL, "http://localhost:3000"),
  ENABLE_GOOGLE_SSO: bool(process.env.ENABLE_GOOGLE_SSO, false),
  GOOGLE_CLIENT_ID: str(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: str(process.env.GOOGLE_CLIENT_SECRET),

  USE_MOCK_LLM: bool(process.env.USE_MOCK_LLM, true),
  DEFAULT_LLM_MODEL: str(process.env.DEFAULT_LLM_MODEL, "claude-sonnet"),
  ANTHROPIC_API_KEY: str(process.env.ANTHROPIC_API_KEY),
  OPENAI_API_KEY: str(process.env.OPENAI_API_KEY),
  GOOGLE_GENAI_API_KEY: str(process.env.GOOGLE_GENAI_API_KEY),
  DEEPSEEK_API_KEY: str(process.env.DEEPSEEK_API_KEY),
  XAI_API_KEY: str(process.env.XAI_API_KEY),
  MOONSHOT_API_KEY: str(process.env.MOONSHOT_API_KEY),
  MINIMAX_API_KEY: str(process.env.MINIMAX_API_KEY),

  // Default FALSE, for the same reason USE_MOCK_YOUTUBE and USE_MOCK_SEARCH
  // are: a key pasted under Admin → API keys should activate the real provider
  // with no redeploy. While this defaulted TRUE it silently won over a
  // perfectly good OpenAI key, which is the identical bug described just below
  // — an install serving fabricated output after the operator had already paid
  // for the real thing. Set it to "true" explicitly to force placeholders.
  USE_MOCK_IMAGES: bool(process.env.USE_MOCK_IMAGES, false),
  // Default FALSE, like USE_MOCK_SEARCH: a key pasted under Admin → API keys
  // activates the real API with no redeploy. It defaulted true, which meant a
  // production install served hashed-up fake subscriber counts even after a
  // real key was supplied — the env flag silently won. Set it to "true"
  // explicitly for local demos; with no key at all the provider now reports
  // nothing rather than inventing figures.
  USE_MOCK_YOUTUBE: bool(process.env.USE_MOCK_YOUTUBE, false),
  // Search activates on key presence (Admin → API keys); default false so an
  // in-app key is sufficient. Set USE_MOCK_SEARCH=true to force the mock.
  USE_MOCK_SEARCH: bool(process.env.USE_MOCK_SEARCH, false),
  TAVILY_API_KEY: str(process.env.TAVILY_API_KEY),
  SERPER_API_KEY: str(process.env.SERPER_API_KEY),
  // NOTE: there is deliberately no USE_MOCK_EMAIL and no USE_MOCK_PRODUCTION.
  // Both existed, both defaulted true, and both were read by NOTHING — while the
  // UI and a code comment told operators to set them false to "send for real" /
  // "wire real TTS", which did nothing either way. What actually decides:
  //   • email    — connected mailbox → SMTP → mock, in `emailFor`
  //   • TTS      — Setting `tts:provider` + `api_key:elevenlabs`, in `lib/tts`
  //   • video    — Setting `video:provider`, in `lib/video`
  //   • images   — Setting `image:provider`, in `lib/images`
  // i.e. in-app configuration, not env flags. Don't reintroduce either without
  // wiring it, and if you do, default it FALSE — see USE_MOCK_IMAGES for why.

  // Phase 4 — video. Mock by default like every other provider; Veo activates
  // with USE_MOCK_VIDEO=false + a Google key (DB Setting or GOOGLE_GENAI_API_KEY).
  USE_MOCK_VIDEO: bool(process.env.USE_MOCK_VIDEO, true),
  YOUTUBE_API_KEY: str(process.env.YOUTUBE_API_KEY),
  // Branded shorts render on HeyGen's HyperFrames cloud. Key resolved DB-first
  // (Setting api_key:heygen) with these env fallbacks, same as every provider.
  HEYGEN_API_KEY: str(process.env.HEYGEN_API_KEY) || str(process.env.HYPERFRAMES_API_KEY),
  VIDEO_MAX_SECONDS: num(process.env.VIDEO_MAX_SECONDS) ?? 8, // short-form first
  VIDEO_COST_PER_SECOND: num(process.env.VIDEO_COST_PER_SECOND) ?? 0.75, // rough Veo estimate, USD
  VIDEO_DAILY_RENDER_CAP: num(process.env.VIDEO_DAILY_RENDER_CAP) ?? 3,

  STORAGE_BACKEND: str(process.env.STORAGE_BACKEND, "local") as "local" | "s3" | "gdrive",
  STORAGE_LOCAL_DIR: str(process.env.STORAGE_LOCAL_DIR, "./.data/uploads"),

  // ⚠ Defaults to the DURABLE backend. It used to default to "memory" and the
  // only other accepted value, "redis", was read by nothing — so production ran
  // an in-memory queue that lost every job on redeploy while the env var said
  // otherwise. "memory" is now opt-in (tests, dev without a DB); "redis" is
  // accepted as an obsolete alias for "db" and warns once at startup.
  JOB_BACKEND: str(process.env.JOB_BACKEND, "db") as "memory" | "db" | "redis",
  REDIS_URL: str(process.env.REDIS_URL),

  EMAIL_FROM: str(process.env.EMAIL_FROM, "MeYouSocial <no-reply@example.com>"),

  LOG_LEVEL: str(process.env.LOG_LEVEL, "info"),
  RATE_LIMIT_PER_MINUTE: num(process.env.RATE_LIMIT_PER_MINUTE) ?? 60,

  LIMIT_SCRIPTS_PER_USER_MONTH: num(process.env.LIMIT_SCRIPTS_PER_USER_MONTH),
  LIMIT_THUMBNAILS_PER_USER_MONTH: num(process.env.LIMIT_THUMBNAILS_PER_USER_MONTH),
  LIMIT_AGENT_RUNS_PER_USER_MONTH: num(process.env.LIMIT_AGENT_RUNS_PER_USER_MONTH),
};

export type Env = typeof env;
