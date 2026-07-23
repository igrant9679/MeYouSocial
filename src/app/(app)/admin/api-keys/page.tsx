import Link from "next/link";
import { KeyRound, CheckCircle2, ExternalLink, HardDrive, AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { saveApiKeyAction, saveSearchKeyAction, saveMediaSettingAction, saveStorageSettingAction } from "@/app/actions/api-keys";
import { getVideoProviderSetting } from "@/lib/video";
import { getStorageBackendSetting } from "@/lib/storage";
import { gdriveStatus, parseServiceAccount } from "@/lib/storage/gdrive";
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

const MEDIA_ROWS: Array<{ provider: "youtube" | "elevenlabs"; label: string; envVar: string; helpUrl: string; helpText: string; note: string }> = [
  { provider: "youtube", label: "YouTube Data API", envVar: "YOUTUBE_API_KEY", helpUrl: "https://console.cloud.google.com/apis/credentials", helpText: "Google Cloud Console → Credentials", note: "Powers real channel/video lookups in Intel and onboarding." },
  { provider: "elevenlabs", label: "ElevenLabs (voiceovers)", envVar: "ELEVENLABS_API_KEY", helpUrl: "https://elevenlabs.io/app/settings/api-keys", helpText: "elevenlabs.io → API keys", note: "Turns the voiceover button on video storyboards into real audio." },
];

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

export default async function ApiKeysPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireRole("ADMIN");
  const { ok, err } = await searchParams;

  const settings = await db.setting.findMany({
    where: { OR: [{ key: { startsWith: "api_key:" } }, { key: { in: ["video:provider", "tts:provider", "storage:backend", "gdrive:service_account", "gdrive:folder_id"] } }] },
  });
  const byKey = new Map(settings.map((s) => [s.key, s.value] as const));
  const videoProvider = await getVideoProviderSetting();
  const ttsProvider = byKey.get("tts:provider") === "elevenlabs" ? "elevenlabs" : "mock";
  const storageBackend = await getStorageBackendSetting();
  const gdriveSa = parseServiceAccount(byKey.get("gdrive:service_account") ?? process.env.GDRIVE_SERVICE_ACCOUNT_JSON ?? "");
  const gdriveFolder = byKey.get("gdrive:folder_id") ?? process.env.GDRIVE_FOLDER_ID ?? "";
  const gdriveConfigured = Boolean(gdriveSa && gdriveFolder);
  // Live check only when it can possibly succeed — keeps the page fast otherwise.
  const drive = gdriveConfigured ? await gdriveStatus() : null;

  return (
    <div className="w-full">
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
          <span className="text-sm">Saved {ok}{ok.includes(":") ? "" : " key"}. New requests will use it within ~30s.</span>
        </div>
      )}
      {err && (
        <div className="card mb-4 flex items-center gap-2" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--rose-on)" }} />
          <span className="text-sm">{err}</span>
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

      {/* Media & video — provider keys + the in-app switches that select them. */}
      <div className="flex items-center gap-3 mb-2 mt-8">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <KeyRound className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Media &amp; video</h1>
          <p className="text-xs text-[var(--mute)]">
            Video rendering, YouTube data, and voiceovers — keys and provider switches, all in-app, no Railway needed.
          </p>
        </div>
      </div>

      <div className="card mb-3">
        <div className="font-mono font-bold text-sm mb-1">Video renderer</div>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          <b>Auto</b> uses Veo when a Google key is set (renders cost money), otherwise the free mock.
          <b> Mock</b> never spends. <b>Veo</b> forces the real provider and errors loudly without a key.
        </p>
        <div className="flex gap-2">
          {(["auto", "mock", "veo"] as const).map((v) => (
            <form key={v} action={saveMediaSettingAction} className="flex-1">
              <input type="hidden" name="setting" value="video:provider" />
              <input type="hidden" name="value" value={v} />
              <button
                className="card w-full text-center cursor-pointer text-sm capitalize !p-2.5"
                style={videoProvider === v ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)", fontWeight: 600 } : undefined}
              >
                {v}{videoProvider === v ? " ✓" : ""}
              </button>
            </form>
          ))}
        </div>
      </div>

      <div className="card mb-3">
        <div className="font-mono font-bold text-sm mb-1">Voiceover (TTS)</div>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          Mock stores the narration script as text (clearly labeled, no fake audio). ElevenLabs produces real audio
          once its key below is saved.
        </p>
        <div className="flex gap-2">
          {(["mock", "elevenlabs"] as const).map((v) => (
            <form key={v} action={saveMediaSettingAction} className="flex-1">
              <input type="hidden" name="setting" value="tts:provider" />
              <input type="hidden" name="value" value={v} />
              <button
                className="card w-full text-center cursor-pointer text-sm capitalize !p-2.5"
                style={ttsProvider === v ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)", fontWeight: 600 } : undefined}
              >
                {v === "mock" ? "Mock (script only)" : "ElevenLabs"}{ttsProvider === v ? " ✓" : ""}
              </button>
            </form>
          ))}
        </div>
      </div>

      {MEDIA_ROWS.map((row) => {
        const dbVal = byKey.get(`api_key:${row.provider}`) ?? "";
        const hasKey = Boolean(dbVal || process.env[row.envVar]);
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
                <div className="text-[11px] text-[var(--mute)] mt-0.5">{row.note}</div>
                {dbVal && <div className="text-[11px] font-mono text-[var(--mute)] mt-0.5">Current: {mask(dbVal)}</div>}
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

      {/* Storage — where uploads, voiceovers and persisted renders live. */}
      <div id="storage" className="flex items-center gap-3 mb-2 mt-8">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--teal-soft)", color: "var(--teal-on)" }}>
          <HardDrive className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Storage</h1>
          <p className="text-xs text-[var(--mute)]">
            Where uploads, voiceovers and saved video renders are kept. <b>Local</b> disk is wiped on every
            Railway redeploy — Google Drive makes files survive.
          </p>
        </div>
      </div>

      <div className="card mb-3">
        <div className="font-mono font-bold text-sm mb-1">Backend</div>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          <b>Local</b> writes to the server disk (fine in dev; <b>ephemeral on Railway</b> — files vanish on redeploy).
          <b> Google Drive</b> stores files durably in the folder below. Switching only affects <em>new</em> files;
          existing files keep working from wherever they were stored.
        </p>
        <div className="flex gap-2 mb-2">
          {(["local", "gdrive"] as const).map((v) => (
            <form key={v} action={saveStorageSettingAction} className="flex-1">
              <input type="hidden" name="setting" value="storage:backend" />
              <input type="hidden" name="value" value={v} />
              <button
                className="card w-full text-center cursor-pointer text-sm !p-2.5"
                style={storageBackend === v ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)", fontWeight: 600 } : undefined}
              >
                {v === "local" ? "Local disk" : "Google Drive"}{storageBackend === v ? " ✓" : ""}
              </button>
            </form>
          ))}
        </div>
        {storageBackend === "gdrive" && !gdriveConfigured && (
          <div className="text-[11px] rounded-lg p-2 flex items-center gap-2" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Drive is selected but not configured — uploads will fail until the service account and folder below are set.
          </div>
        )}
        {drive && (
          <div className="text-[11px] font-mono rounded-lg p-2" style={{ background: drive.ok ? "var(--green-soft)" : "var(--rose-soft)", color: drive.ok ? "var(--green-on)" : "var(--rose-on)" }}>
            {drive.ok ? (
              <>
                Connected as {drive.email}
                {drive.folderName ? <> · folder “{drive.folderName}”</> : null}
                {typeof drive.usedBytes === "number" && typeof drive.limitBytes === "number" && drive.limitBytes > 0 ? (
                  <> · {(drive.usedBytes / 1e9).toFixed(2)} / {(drive.limitBytes / 1e9).toFixed(0)} GB used</>
                ) : null}
              </>
            ) : (
              <>Drive check failed: {drive.error}</>
            )}
          </div>
        )}
      </div>

      <form action={saveStorageSettingAction} className="card mb-3">
        <input type="hidden" name="setting" value="gdrive:service_account" />
        <div className="font-mono font-bold text-sm flex items-center gap-2 mb-1">
          Service account key (JSON)
          {gdriveSa && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
              <CheckCircle2 className="w-3 h-3" /> configured
            </span>
          )}
        </div>
        {gdriveSa && <div className="text-[11px] font-mono text-[var(--mute)] mb-1 break-all">{gdriveSa.client_email}</div>}
        <p className="text-[11px] text-[var(--mute)] mb-2">
          Google Cloud Console → IAM &amp; Admin → Service Accounts → create one (no roles needed) → Keys →
          Add key → JSON. Enable the <b>Google Drive API</b> on the project. Paste the whole file here — it&apos;s
          stored in the database, never in git.
        </p>
        <div className="flex flex-col gap-2">
          <textarea
            name="value"
            rows={3}
            placeholder={gdriveSa ? "Paste a new JSON key to replace, or save empty to clear" : '{ "type": "service_account", "client_email": "…", "private_key": "…", … }'}
            className="w-full border border-[var(--line-2)] rounded-lg p-2 text-xs font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <SubmitButton className="btn primary sm self-end" pendingText="Saving…">Save</SubmitButton>
        </div>
      </form>

      <form action={saveStorageSettingAction} className="card mb-3">
        <input type="hidden" name="setting" value="gdrive:folder_id" />
        <div className="font-mono font-bold text-sm flex items-center gap-2 mb-1">
          Drive folder
          {gdriveFolder && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
              <CheckCircle2 className="w-3 h-3" /> configured
            </span>
          )}
        </div>
        {gdriveFolder && <div className="text-[11px] font-mono text-[var(--mute)] mb-1 break-all">{gdriveFolder}</div>}
        <p className="text-[11px] text-[var(--mute)] mb-2">
          Create a folder in Drive and share it with the service account&apos;s email as <b>Editor</b>, then paste the
          folder&apos;s URL (or id) here. Saving runs a real write test into the folder and reports any problem.
        </p>
        <div className="flex gap-2">
          <input
            name="value"
            type="text"
            placeholder={gdriveFolder ? "Paste a new folder URL/id to replace, or save empty to clear" : "https://drive.google.com/drive/folders/…"}
            className="flex-1 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
            autoComplete="off"
          />
          <SubmitButton className="btn primary sm" pendingText="Testing…">Save</SubmitButton>
        </div>
      </form>

      <div className="card mb-3 text-xs text-[var(--mute)] leading-relaxed">
        <p className="mb-1"><strong>Honest tradeoffs:</strong></p>
        <p className="mb-1">· Files stay <b>private</b> in Drive — the app streams them to signed-in members via <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>/api/files</code>. Nothing is public-by-link, but every view passes through this server.</p>
        <p className="mb-1">· On a personal (free) Drive, uploaded files are owned by the service account and count against <b>its own 15&nbsp;GB quota</b> — not yours. The connection banner above shows real usage. A Google Workspace <b>Shared Drive</b> pools quota instead; both work here.</p>
        <p>· Existing locally-stored files are <b>not migrated</b> (on Railway they don&apos;t survive a redeploy anyway). Switching backends only routes new files.</p>
      </div>
    </div>
  );
}
