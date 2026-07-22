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

  USE_MOCK_IMAGES: bool(process.env.USE_MOCK_IMAGES, true),
  USE_MOCK_YOUTUBE: bool(process.env.USE_MOCK_YOUTUBE, true),
  USE_MOCK_SEARCH: bool(process.env.USE_MOCK_SEARCH, true),
  USE_MOCK_EMAIL: bool(process.env.USE_MOCK_EMAIL, true),
  USE_MOCK_PRODUCTION: bool(process.env.USE_MOCK_PRODUCTION, true),

  // Phase 4 — video. Mock by default like every other provider; Veo activates
  // with USE_MOCK_VIDEO=false + a Google key (DB Setting or GOOGLE_GENAI_API_KEY).
  USE_MOCK_VIDEO: bool(process.env.USE_MOCK_VIDEO, true),
  YOUTUBE_API_KEY: str(process.env.YOUTUBE_API_KEY),
  VIDEO_MAX_SECONDS: num(process.env.VIDEO_MAX_SECONDS) ?? 8, // short-form first
  VIDEO_COST_PER_SECOND: num(process.env.VIDEO_COST_PER_SECOND) ?? 0.75, // rough Veo estimate, USD
  VIDEO_DAILY_RENDER_CAP: num(process.env.VIDEO_DAILY_RENDER_CAP) ?? 3,

  STORAGE_BACKEND: str(process.env.STORAGE_BACKEND, "local") as "local" | "s3" | "gdrive",
  STORAGE_LOCAL_DIR: str(process.env.STORAGE_LOCAL_DIR, "./.data/uploads"),

  JOB_BACKEND: str(process.env.JOB_BACKEND, "memory") as "memory" | "redis",
  REDIS_URL: str(process.env.REDIS_URL),

  EMAIL_FROM: str(process.env.EMAIL_FROM, "MeYouSocial <no-reply@example.com>"),

  LOG_LEVEL: str(process.env.LOG_LEVEL, "info"),
  RATE_LIMIT_PER_MINUTE: num(process.env.RATE_LIMIT_PER_MINUTE) ?? 60,

  LIMIT_SCRIPTS_PER_USER_MONTH: num(process.env.LIMIT_SCRIPTS_PER_USER_MONTH),
  LIMIT_THUMBNAILS_PER_USER_MONTH: num(process.env.LIMIT_THUMBNAILS_PER_USER_MONTH),
  LIMIT_AGENT_RUNS_PER_USER_MONTH: num(process.env.LIMIT_AGENT_RUNS_PER_USER_MONTH),
};

export type Env = typeof env;
