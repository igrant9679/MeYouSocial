import Link from "next/link";
import { LineChart, CheckCircle2, AlertTriangle, CirclePlay, Search, BarChart3, RefreshCw } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { getGscConfig } from "@/lib/analytics/gsc";
import { getGa4Config } from "@/lib/analytics/ga4";
import { youtubeOauthConnected, youtubeRedirectUri, getYoutubeOauthConfig } from "@/lib/youtube/oauth";
import { getPublicUrl } from "@/lib/public-url";
import {
  saveGscAction,
  clearGscAction,
  saveGa4Action,
  clearGa4Action,
  saveYoutubeOauthAction,
  connectYoutubeAction,
  disconnectYoutubeAction,
  syncAnalyticsNowAction,
} from "@/app/actions/analytics-connections";

// Admin → Analytics: the real-data inputs (Search Console, GA4, YouTube).
// Deliberately separate from API keys: these are per-workspace *connections* to
// the company's own properties, not provider credentials.

export default async function AnalyticsConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { workspace } = await requireRole("ADMIN");
  const { ok, err } = await searchParams;

  const [gsc, ga4, yt, ytCfg, origin, rows, driveSa] = await Promise.all([
    getGscConfig(workspace.id),
    getGa4Config(workspace.id),
    youtubeOauthConnected(workspace.id),
    getYoutubeOauthConfig(workspace.id),
    getPublicUrl(),
    db.workspaceSetting.findMany({
      where: {
        workspaceId: workspace.id,
        key: { in: ["gsc:site_url", "ga4:property_id", "youtube_oauth:client_id", "gsc:service_account", "ga4:service_account"] },
      },
    }),
    db.setting.findUnique({ where: { key: "gdrive:service_account" } }),
  ]);
  const val = new Map(rows.map((r) => [r.key, r.value]));
  const sharedSaEmail = (() => {
    try {
      return (JSON.parse(driveSa?.value ?? "{}") as { client_email?: string }).client_email ?? "";
    } catch {
      return "";
    }
  })();

  const Status = ({ on, label }: { on: boolean; label: string }) => (
    <span
      className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
      style={{ background: on ? "var(--green-soft)" : "var(--zebra)", color: on ? "var(--green-on)" : "var(--mute)" }}
    >
      {on ? "connected" : label}
    </span>
  );

  return (
    <main className="w-full">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
          <LineChart className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-xl leading-tight">Analytics connections</h1>
          <p className="text-xs text-[var(--mute)]">
            Real performance data for <b>{workspace.name}</b>. Each connection is verified live when you save — nothing here
            guesses. Provider API keys live under <Link href="/admin/api-keys" className="underline">API keys</Link>.
          </p>
        </div>
      </div>

      {ok && (
        <div className="card mb-4 flex items-center gap-2" style={{ background: "var(--green-soft)", borderColor: "var(--green)" }}>
          <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "var(--green-on)" }} />
          <span className="text-sm">{ok}</span>
        </div>
      )}
      {err && (
        <div className="card mb-4 flex items-center gap-2" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--rose-on)" }} />
          <span className="text-sm">{err}</span>
        </div>
      )}

      {sharedSaEmail && (
        <div className="card mb-4 text-xs text-[var(--mute)] leading-relaxed">
          <p>
            <strong>Shortcut:</strong> a platform Google service account already exists (
            <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>{sharedSaEmail}</code>). Grant that
            address access to your Search Console property and GA4 property and you can leave the JSON boxes below empty —
            they fall back to it.
          </p>
        </div>
      )}

      {/* ── Search Console ─────────────────────────────────────────────── */}
      <form action={saveGscAction} className="card mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
          <h2 className="font-mono font-bold text-sm flex-1">Google Search Console</h2>
          <Status on={Boolean(gsc)} label="not connected" />
        </div>
        <p className="text-[11px] text-[var(--mute)] mb-2 leading-relaxed">
          Queries, clicks, impressions and average position for your site. Uses a <b>service account</b> — no OAuth: paste its
          JSON (or use the shared one above), then in Search Console → <i>Settings → Users and permissions</i> add the service
          account&apos;s email as a user.
        </p>
        <label className="block text-[11px] text-[var(--mute)] mb-2">
          Site / property
          <input
            name="site_url"
            defaultValue={val.get("gsc:site_url") ?? ""}
            placeholder="sc-domain:example.com  or  https://example.com/"
            className="w-full text-sm font-mono mt-0.5"
          />
          <span className="text-[10px]">Domain property → <code>sc-domain:example.com</code>. URL-prefix → the exact origin.</span>
        </label>
        <label className="block text-[11px] text-[var(--mute)] mb-2">
          Service account JSON {val.get("gsc:service_account") ? <span style={{ color: "var(--green-on)" }}>· stored</span> : sharedSaEmail ? "(optional — falls back to the shared one)" : ""}
          <textarea name="service_account" rows={3} placeholder='{"client_email":"…","private_key":"…"}' className="w-full text-[11px] font-mono mt-0.5" />
        </label>
        <div className="flex items-center gap-2">
          <SubmitButton className="btn primary" pendingText="Verifying…">Save &amp; verify</SubmitButton>
          {gsc && (
            <SubmitButton className="btn" formAction={clearGscAction} pendingText="Clearing…">Disconnect</SubmitButton>
          )}
        </div>
      </form>

      {/* ── GA4 ────────────────────────────────────────────────────────── */}
      <form action={saveGa4Action} className="card mb-3">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
          <h2 className="font-mono font-bold text-sm flex-1">Google Analytics 4</h2>
          <Status on={Boolean(ga4)} label="not connected" />
        </div>
        <p className="text-[11px] text-[var(--mute)] mb-2 leading-relaxed">
          Sessions, users and conversions per page. Same service-account model: grant the address <b>Viewer</b> under GA4 →
          <i> Admin → Property access management</i>. Saving runs a real report as the test.
        </p>
        <label className="block text-[11px] text-[var(--mute)] mb-2">
          Property ID
          <input
            name="property_id"
            defaultValue={val.get("ga4:property_id") ?? ""}
            placeholder="123456789"
            className="w-full text-sm font-mono mt-0.5"
          />
          <span className="text-[10px]">The numeric property id (GA4 → Admin → Property details) — <b>not</b> the G-XXXX measurement ID.</span>
        </label>
        <label className="block text-[11px] text-[var(--mute)] mb-2">
          Service account JSON {val.get("ga4:service_account") ? <span style={{ color: "var(--green-on)" }}>· stored</span> : sharedSaEmail ? "(optional — falls back to the shared one)" : ""}
          <textarea name="service_account" rows={3} placeholder='{"client_email":"…","private_key":"…"}' className="w-full text-[11px] font-mono mt-0.5" />
        </label>
        <div className="flex items-center gap-2">
          <SubmitButton className="btn primary" pendingText="Verifying…">Save &amp; verify</SubmitButton>
          {ga4 && (
            <SubmitButton className="btn" formAction={clearGa4Action} pendingText="Clearing…">Disconnect</SubmitButton>
          )}
        </div>
      </form>

      {/* ── YouTube OAuth ──────────────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="flex items-center gap-2 mb-1">
          <CirclePlay className="w-4 h-4" style={{ color: "var(--rose-on)" }} />
          <h2 className="font-mono font-bold text-sm flex-1">YouTube (your channel)</h2>
          <Status on={yt.connected} label="not connected" />
        </div>
        <p className="text-[11px] text-[var(--mute)] mb-2 leading-relaxed">
          Uploading and your own channel&apos;s view/watch-time data. This needs <b>OAuth</b>, not a key — YouTube won&apos;t let a
          service account touch a channel. (The Data API key under <Link href="/admin/api-keys" className="underline">API keys</Link> only
          reads public data.)
        </p>
        <div className="text-[11px] text-[var(--mute)] mb-2 leading-relaxed">
          In Google Cloud Console → <i>APIs &amp; Services → Credentials</i>, create an <b>OAuth client ID</b> (type: Web
          application) and add this exact redirect URI:
          <code className="font-mono text-[10px] px-1.5 py-0.5 rounded ml-1 inline-block" style={{ background: "var(--zebra)" }}>
            {youtubeRedirectUri(origin)}
          </code>
        </div>

        {yt.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs flex-1">{yt.channel || "Channel connected."}</span>
            <form action={disconnectYoutubeAction}>
              <SubmitButton className="btn" pendingText="Disconnecting…">Disconnect</SubmitButton>
            </form>
          </div>
        ) : (
          <>
            <form action={saveYoutubeOauthAction} className="flex flex-wrap items-end gap-2 mb-2">
              <label className="flex-1 min-w-52 text-[11px] text-[var(--mute)]">
                OAuth client ID
                <input name="client_id" defaultValue={val.get("youtube_oauth:client_id") ?? ""} placeholder="…apps.googleusercontent.com" className="w-full text-sm font-mono mt-0.5" />
              </label>
              <label className="flex-1 min-w-40 text-[11px] text-[var(--mute)]">
                Client secret {ytCfg?.clientSecret ? <span style={{ color: "var(--green-on)" }}>· stored</span> : ""}
                <input name="client_secret" type="password" placeholder={ytCfg?.clientSecret ? "•••••• (leave blank to keep)" : "GOCSPX-…"} className="w-full text-sm font-mono mt-0.5" autoComplete="off" />
              </label>
              <SubmitButton className="btn" pendingText="Saving…">Save client</SubmitButton>
            </form>
            <form action={connectYoutubeAction}>
              <SubmitButton className="btn primary" pendingText="Redirecting…" disabled={!ytCfg}>
                <CirclePlay className="w-4 h-4" /> Connect YouTube
              </SubmitButton>
              {!ytCfg && <span className="text-[11px] text-[var(--mute)] ml-2">Save a client ID and secret first.</span>}
            </form>
          </>
        )}
      </div>

      {/* Sync — the join between these connections and Insights. */}
      {(gsc || ga4) && (
        <div className="card mb-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-52">
            <h2 className="font-mono font-bold text-sm mb-0.5">Sync to Insights</h2>
            <p className="text-[11px] text-[var(--mute)] leading-relaxed">
              Pulls per-day clicks, impressions, position and sessions into each published post, which is what fills the
              search &amp; traffic panels on <Link href="/insights" className="underline">Insights</Link>. Runs automatically
              every few hours — Search Console data lags about two days, so more often wouldn&apos;t show more.
              Posts are matched by their published URL, falling back to slug.
            </p>
          </div>
          <form action={syncAnalyticsNowAction}>
            <SubmitButton className="btn" pendingText="Syncing…"><RefreshCw className="w-3.5 h-3.5" /> Sync now</SubmitButton>
          </form>
        </div>
      )}

      <div className="card text-xs text-[var(--mute)] leading-relaxed">
        <p className="mb-1">
          <strong>Why these matter:</strong> recommendations are only as good as the data behind them. Until a source is
          connected, anything that would depend on it reports “no data” rather than guessing — the same truthfulness rule the
          rest of the app follows.
        </p>
        <p>
          Still missing and worth adding: a <b>search key</b> (Tavily or Serper) for keyword and competitor research —
          that one lives under <Link href="/admin/api-keys" className="underline">API keys → Search</Link>. Social activity comes from
          <Link href="/admin/connections" className="underline"> Connections</Link> (Unipile).
        </p>
      </div>
    </main>
  );
}
