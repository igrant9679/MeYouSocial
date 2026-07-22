import Link from "next/link";
import { KeyRound, CheckCircle2, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { saveApiKeyAction, saveSearchKeyAction } from "@/app/actions/api-keys";
import { SubmitButton } from "@/components/SubmitButton";

// In-app API key management. Admins can paste provider keys here
// instead of editing Railway env vars. DB-stored keys override env vars; env vars
// remain the fallback so existing deployments keep working.

type Row = {
  provider: "anthropic" | "openai" | "google" | "deepseek" | "xai" | "moonshot" | "minimax";
  label: string;
  envVar: string;
  envValue: string;
  helpUrl: string;
  helpText: string;
};

const ROWS: Row[] = [
  { provider: "anthropic", label: "Anthropic (Claude)",  envVar: "ANTHROPIC_API_KEY",     envValue: env.ANTHROPIC_API_KEY,     helpUrl: "https://console.anthropic.com/settings/keys", helpText: "console.anthropic.com → API Keys" },
  { provider: "google",    label: "Google (Gemini)",     envVar: "GOOGLE_GENAI_API_KEY",  envValue: env.GOOGLE_GENAI_API_KEY,  helpUrl: "https://aistudio.google.com/apikey",          helpText: "aistudio.google.com/apikey" },
  { provider: "openai",    label: "OpenAI (GPT)",        envVar: "OPENAI_API_KEY",        envValue: env.OPENAI_API_KEY,        helpUrl: "https://platform.openai.com/api-keys",        helpText: "platform.openai.com → API keys" },
  { provider: "deepseek",  label: "DeepSeek",            envVar: "DEEPSEEK_API_KEY",      envValue: env.DEEPSEEK_API_KEY,      helpUrl: "https://platform.deepseek.com/api_keys",      helpText: "platform.deepseek.com" },
  { provider: "xai",       label: "xAI (Grok)",          envVar: "XAI_API_KEY",           envValue: env.XAI_API_KEY,           helpUrl: "https://console.x.ai",                        helpText: "console.x.ai" },
  { provider: "moonshot",  label: "Moonshot (Kimi)",     envVar: "MOONSHOT_API_KEY",      envValue: env.MOONSHOT_API_KEY,      helpUrl: "https://platform.moonshot.ai",                helpText: "platform.moonshot.ai" },
  { provider: "minimax",   label: "MiniMax",             envVar: "MINIMAX_API_KEY",       envValue: env.MINIMAX_API_KEY,       helpUrl: "https://www.minimax.io",                      helpText: "minimax.io" },
];

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

export default async function ApiKeysPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  await requireRole("ADMIN");
  const { ok } = await searchParams;

  const settings = await db.setting.findMany({ where: { key: { startsWith: "api_key:" } } });
  const byKey = new Map(settings.map((s) => [s.key, s.value] as const));

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <KeyRound className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">LLM API keys</h1>
          <p className="text-xs text-[var(--mute)]">Paste a provider key to enable real model calls. DB-stored keys override env vars.</p>
        </div>
      </div>

      {ok && (
        <div className="card mb-4 flex items-center gap-2" style={{ background: "var(--green-soft)", borderColor: "var(--green)" }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} />
          <span className="text-sm">Saved {ok} key. New requests will use it within ~30s.</span>
        </div>
      )}

      <div className="card mb-4 text-xs text-[var(--mute)] leading-relaxed">
        <p className="mb-1"><strong>Two sources, one resolved value:</strong> we read from the database first, then fall back to the env var if no DB value is set.</p>
        <p>To <em>remove</em> a DB-stored key and fall back to env, save with the value field empty.</p>
        <p className="mt-2">For background generations, also flip <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>USE_MOCK_LLM=false</code> on Railway.</p>
      </div>

      {ROWS.map((row) => {
        const dbVal = byKey.get(`api_key:${row.provider}`) ?? "";
        const resolved = dbVal || row.envValue;
        const hasKey = Boolean(resolved);
        return (
          <form key={row.provider} action={saveApiKeyAction} className="card mb-3">
            <input type="hidden" name="provider" value={row.provider} />
            <div className="flex items-start gap-3 mb-2">
              <div className="flex-1">
                <div className="font-mono font-bold text-sm flex items-center gap-2">
                  {row.label}
                  {hasKey && (
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                      <CheckCircle2 className="w-3 h-3" /> active
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--mute)] font-mono mt-0.5">{row.envVar}</div>
                {resolved && <div className="text-[11px] font-mono text-[var(--mute)] mt-0.5">Current: {mask(resolved)}</div>}
                <Link href={row.helpUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] inline-flex items-center gap-1 mt-1" style={{ color: "var(--accent)" }}>
                  Get a key from {row.helpText} <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                name="value"
                type="password"
                placeholder={dbVal ? "Paste a new key to replace, or leave empty to clear DB value" : "Paste your API key here"}
                className="flex-1 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
                autoComplete="off"
              />
              <SubmitButton className="btn primary sm" pendingText="Saving…">Save</SubmitButton>
            </div>
          </form>
        );
      })}

      {/* Search providers — power content-gap analysis, SERP outlines, and web research. */}
      <div className="flex items-center gap-3 mb-2 mt-8">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
          <KeyRound className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Search API keys</h1>
          <p className="text-xs text-[var(--mute)]">
            One key turns on real web search: content-gap analysis, competitor comparison, research.
            Tavily is checked first, then Serper. No env changes needed — takes effect within ~30s.
          </p>
        </div>
      </div>
      {(
        [
          { vendor: "tavily", label: "Tavily", envVar: "TAVILY_API_KEY", envValue: env.TAVILY_API_KEY, helpUrl: "https://app.tavily.com", helpText: "app.tavily.com (free tier available)" },
          { vendor: "serper", label: "Serper (Google results)", envVar: "SERPER_API_KEY", envValue: env.SERPER_API_KEY, helpUrl: "https://serper.dev", helpText: "serper.dev (free tier available)" },
        ] as const
      ).map((row) => {
        const dbVal = byKey.get(`api_key:${row.vendor}`) ?? "";
        const resolved = dbVal || row.envValue;
        const hasKey = Boolean(resolved);
        return (
          <form key={row.vendor} action={saveSearchKeyAction} className="card mb-3">
            <input type="hidden" name="vendor" value={row.vendor} />
            <div className="flex items-start gap-3 mb-2">
              <div className="flex-1">
                <div className="font-mono font-bold text-sm flex items-center gap-2">
                  {row.label}
                  {hasKey && (
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                      <CheckCircle2 className="w-3 h-3" /> active
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--mute)] font-mono mt-0.5">{row.envVar}</div>
                {resolved && <div className="text-[11px] font-mono text-[var(--mute)] mt-0.5">Current: {mask(resolved)}</div>}
                <Link href={row.helpUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] inline-flex items-center gap-1 mt-1" style={{ color: "var(--accent)" }}>
                  Get a key from {row.helpText} <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                name="value"
                type="password"
                placeholder={dbVal ? "Paste a new key to replace, or leave empty to clear DB value" : "Paste your API key here"}
                className="flex-1 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
                autoComplete="off"
              />
              <SubmitButton className="btn primary sm" pendingText="Saving…">Save</SubmitButton>
            </div>
          </form>
        );
      })}
    </div>
  );
}
