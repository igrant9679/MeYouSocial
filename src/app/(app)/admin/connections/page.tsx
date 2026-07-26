import Link from "next/link";
import { Plug, Mail, CheckCircle2, AlertTriangle, Star, Trash2, Share2, RefreshCw, KeyRound } from "lucide-react";
import { requireRole, isPlatformOperator as isOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { unipileConfigured } from "@/lib/unipile";
import { zernioConfigured, ZERNIO_PLATFORMS } from "@/lib/zernio";
import { getPublicUrl } from "@/lib/public-url";
import {
  connectAccountAction,
  connectSocialAccountAction,
  syncSocialAccountsAction,
  disconnectAccountAction,
  disconnectSocialAccountAction,
  setDefaultAccountAction,
  setDefaultSocialAccountAction,
  saveUnipileConfigAction,
  testUnipileConfigAction,
  clearUnipileConfigAction,
  saveZernioConfigAction,
  testZernioConfigAction,
  clearZernioConfigAction,
} from "@/app/actions/connections";

/**
 * Admin → Connections.
 *
 * TWO providers, deliberately, each doing the one thing it's good at:
 *   • Zernio — all social publishing, account connection and analytics, across
 *     15 networks. Replaced Unipile on 2026-07-26 because Unipile had dropped
 *     networks this product needs (Facebook, Twitter/X among them).
 *   • Unipile — EMAIL ONLY. Zernio has no email channel, and Railway blocks
 *     outbound SMTP, so a connected mailbox over HTTPS is still the only way
 *     real mail leaves this host.
 */

type SearchParams = { ok?: string; err?: string; connected?: string; failed?: string };

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspace, user } = await requireRole("ADMIN");
  const { ok, err, connected, failed } = await searchParams;

  const isPlatformOperator = isOperator(user.email);
  const [emailReady, socialReady, emailAccounts, socialAccounts, origin] = await Promise.all([
    unipileConfigured(),
    zernioConfigured(),
    db.unipileAccount.findMany({
      where: { workspaceId: workspace.id, kind: "email" },
      orderBy: [{ createdAt: "asc" }],
    }),
    db.zernioAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ status: "asc" }, { platform: "asc" }, { createdAt: "asc" }],
    }),
    getPublicUrl(),
  ]);

  const cfgRows = isPlatformOperator
    ? await db.setting.findMany({
        where: { key: { in: ["unipile:dsn", "unipile:api_key", "zernio:api_key", "zernio:webhook_secret"] } },
      })
    : [];
  const cfg = new Map(cfgRows.map((r) => [r.key, r.value] as const));
  // Imported dynamically: the lock reaches node:net/node:tls via the Redis
  // client, and keeping it out of this module's static graph keeps those out
  // of any Edge bundle Next builds from it.
  const lock = isPlatformOperator
    ? await (await import("@/lib/lock")).checkLockBackend()
    : { ok: true, backend: "", detail: "" };

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Plug className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Connections</h1>
          <p className="text-xs text-[var(--mute)]">
            Connect <b>{workspace.name}</b>&apos;s social profiles (via Zernio) and its mailbox (via Unipile, which is
            how email leaves this host at all — outbound SMTP is blocked here).
          </p>
        </div>
      </div>

      {(ok || connected) && (
        <div className="card mb-3 flex items-start gap-2 text-sm" style={{ background: "var(--green-soft)", borderColor: "var(--green)" }}>
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--green)" }} />
          <span>{connected ? "Account connected — it should appear below within a few seconds." : ok === "disconnected" ? "Account disconnected." : ok === "default" ? "Default account updated." : ok}</span>
        </div>
      )}
      {(err || failed) && (
        <div className="card mb-3 flex items-start gap-2 text-sm" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--rose-on)" }} />
          <span>{failed ? "Connection was cancelled or failed. Nothing was saved." : err === "unconfigured" ? "Unipile isn't set up yet — the platform operator must add the DSN + API key below." : err}</span>
        </div>
      )}

      {/* ── Social (Zernio) ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 mt-6 flex-wrap">
        <Share2 className="w-4 h-4" style={{ color: "var(--purple-on)" }} />
        <h2 className="font-mono font-bold text-sm">Social accounts</h2>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
          Zernio
        </span>
        <span className="flex-1" />
        {socialReady && socialAccounts.length > 0 && (
          <form action={syncSocialAccountsAction}>
            <SubmitButton className="btn sm" pendingText="Refreshing…" title="Re-read this workspace's accounts from Zernio">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh from Zernio
            </SubmitButton>
          </form>
        )}
      </div>

      {!socialReady && (
        <div className="card mb-3 text-sm" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <b>Zernio isn&apos;t configured yet.</b>{" "}
          {isPlatformOperator
            ? "Add your API key below to enable connecting social accounts."
            : "The platform operator needs to add the Zernio API key before social accounts can be connected."}
        </div>
      )}

      {socialAccounts.length === 0 ? (
        <div className="card mb-3 text-xs text-[var(--mute)]">
          No social profile connected — connect one to publish from <Link href="/social" className="underline">Social</Link> or a blog post&apos;s Distribute tab.
        </div>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {socialAccounts.map((a) => {
            const p = ZERNIO_PLATFORMS.find((x) => x.slug === a.platform);
            const live = a.status === "connected";
            return (
              <li key={a.id} className="card flex items-center gap-2 flex-wrap" style={{ opacity: live ? 1 : 0.6 }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p?.color ?? "var(--mute)" }} />
                <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                  {p?.label ?? a.platform}
                </span>
                <span className="text-sm font-semibold truncate">{a.displayName ?? a.username ?? "(connected account)"}</span>
                {a.username && a.displayName && <span className="text-xs text-[var(--mute)] truncate">{a.username}</span>}
                {!live && <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--rose-on)" }}>disconnected</span>}
                {a.isDefault && live && (
                  <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                    <Star className="w-3 h-3" /> default
                  </span>
                )}
                <span className="flex-1" />
                {a.profileUrl && (
                  <a href={a.profileUrl} target="_blank" rel="noopener noreferrer" className="btn sm" title="Open the profile">View</a>
                )}
                {!a.isDefault && live && (
                  <form action={setDefaultSocialAccountAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="btn sm" title="Post from this account by default">Make default</button>
                  </form>
                )}
                <form action={disconnectSocialAccountAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="btn sm" title="Forget this account here (revoke access in Zernio)"><Trash2 className="w-3.5 h-3.5" /></button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 mb-8">
        {ZERNIO_PLATFORMS.map((p) => (
          <form key={p.slug} action={connectSocialAccountAction}>
            <input type="hidden" name="platform" value={p.slug} />
            <SubmitButton className="btn sm" disabled={!socialReady} pendingText="Opening…">
              <span className="w-2 h-2 rounded-full" style={{ background: p.color }} /> {p.label}
            </SubmitButton>
          </form>
        ))}
      </div>

      {/* ── Email (Unipile) ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Mail className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
        <h2 className="font-mono font-bold text-sm">Email account</h2>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
          Unipile
        </span>
      </div>
      <p className="text-[11px] text-[var(--mute)] mb-2 leading-relaxed">
        Zernio doesn&apos;t send email, and this host blocks outbound SMTP — so notifications, invitations and password
        resets go out through a connected mailbox over HTTPS. Without one they fall back to a mock and are never
        actually delivered.
      </p>
      {emailAccounts.length === 0 ? (
        <div className="card mb-2 text-xs text-[var(--mute)]">No mailbox connected — email is not being delivered.</div>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {emailAccounts.map((a) => (
            <li key={a.id} className="card flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--panel)", color: "var(--mute)" }}>{a.provider}</span>
              <span className="text-sm font-semibold truncate">{a.name ?? "(connected mailbox)"}</span>
              {a.isDefault && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                  <Star className="w-3 h-3" /> default
                </span>
              )}
              <span className="flex-1" />
              {!a.isDefault && (
                <form action={setDefaultAccountAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="btn sm" title="Send from this mailbox by default">Make default</button>
                </form>
              )}
              <form action={disconnectAccountAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="btn sm" title="Disconnect"><Trash2 className="w-3.5 h-3.5" /></button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={connectAccountAction} className="mb-8">
        <SubmitButton className="btn primary sm" disabled={!emailReady} pendingText="Opening…">
          <Mail className="w-4 h-4" /> Connect a mailbox (Gmail, Outlook, or any IMAP)
        </SubmitButton>
      </form>

      {/* ── Platform operator ───────────────────────────────────────────── */}
      {isPlatformOperator && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-8 pt-4 border-t border-[var(--line)]">
            <KeyRound className="w-4 h-4" style={{ color: "var(--purple-on)" }} />
            <h2 className="font-mono font-bold text-sm">Zernio API key (platform)</h2>
          </div>
          <div className="card mb-3 text-xs text-[var(--mute)] leading-relaxed">
            One Zernio team key serves every workspace on this install; each workspace gets its own Zernio{" "}
            <b>profile</b> and connects its own accounts under it. Create a key in your{" "}
            <a href="https://zernio.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>Zernio dashboard</a>{" "}
            — it starts <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>sk_</code> followed by 64 hex characters.
          </div>
          <form action={saveZernioConfigAction} className="card mb-2 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
                API key {cfg.get("zernio:api_key") && <span className="text-[var(--green-on)]">· {mask(cfg.get("zernio:api_key")!)}</span>}
              </span>
              <input
                name="apiKey"
                type="password"
                placeholder={cfg.get("zernio:api_key") ? "Paste a new key to replace it" : "sk_…"}
                className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
                Webhook secret {cfg.get("zernio:webhook_secret") && <span className="text-[var(--green-on)]">· set</span>}
              </span>
              <input
                name="webhookSecret"
                type="password"
                placeholder={cfg.get("zernio:webhook_secret") ? "Leave blank to keep the stored secret" : "From the webhook you create in Zernio"}
                className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
                autoComplete="off"
              />
            </label>
            <p className="text-[11px] text-[var(--mute)] leading-relaxed">
              Saving calls Zernio with the key first and only stores it if it works. Point a Zernio webhook at{" "}
              <code className="font-mono px-1 rounded break-all" style={{ background: "var(--zebra)" }}>{origin}/api/zernio/webhook</code>{" "}
              subscribed to <b>account.connected</b>, <b>account.disconnected</b> and the <b>post.*</b> events, then paste
              its signing secret above. <b>Until the secret is set, the webhook rejects every delivery</b> — it fails
              closed rather than accepting unsigned posts.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton className="btn primary sm" pendingText="Verifying…">Verify &amp; save</SubmitButton>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--mute)]">
                <input type="checkbox" name="force" /> Save even if the check fails
              </label>
            </div>
          </form>
          <div className="flex flex-wrap gap-2 mb-6">
            <form action={testZernioConfigAction}>
              <SubmitButton className="btn sm" pendingText="Testing…" disabled={!socialReady}>Test stored key</SubmitButton>
            </form>
            <form action={clearZernioConfigAction}>
              <SubmitButton className="btn sm" pendingText="Clearing…" disabled={!socialReady}>
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </SubmitButton>
            </form>
          </div>

          <div className="flex items-center gap-2 mb-2 mt-6 pt-4 border-t border-[var(--line)]">
            <Mail className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
            <h2 className="font-mono font-bold text-sm">Unipile credentials (platform · email only)</h2>
          </div>
          <div className="card mb-3 text-xs text-[var(--mute)] leading-relaxed">
            Kept solely for email delivery. Get the <b>DSN</b> (e.g.{" "}
            <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>api8.unipile.com:13443</code>) and an
            <b> API key</b> from{" "}
            <a href="https://dashboard.unipile.com/access-tokens" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>dashboard.unipile.com</a>.
          </div>
          <form action={saveUnipileConfigAction} className="card mb-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
                DSN {cfg.get("unipile:dsn") && <span className="text-[var(--green-on)]">· set</span>}
              </span>
              <input name="dsn" defaultValue={cfg.get("unipile:dsn") ?? ""} placeholder="api8.unipile.com:13443" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
                API key {cfg.get("unipile:api_key") && <span className="text-[var(--green-on)]">· {mask(cfg.get("unipile:api_key")!)}</span>}
              </span>
              <input name="apiKey" type="password" placeholder={cfg.get("unipile:api_key") ? "Leave blank to keep the stored key" : "Paste your Unipile API key"} className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" autoComplete="off" />
            </label>
            <p className="text-[11px] text-[var(--mute)]">Verified against Unipile before it&apos;s stored.</p>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton className="btn primary sm" pendingText="Verifying…">Verify &amp; save</SubmitButton>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--mute)]">
                <input type="checkbox" name="force" /> Save even if the check fails
              </label>
            </div>
          </form>
          <div className="flex flex-wrap gap-2 mb-3">
            <form action={testUnipileConfigAction}>
              <SubmitButton className="btn sm" pendingText="Testing…" disabled={!emailReady}>Test stored credentials</SubmitButton>
            </form>
            <form action={clearUnipileConfigAction}>
              <SubmitButton className="btn sm" pendingText="Clearing…" disabled={!emailReady}>
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </SubmitButton>
            </form>
          </div>

          {/* Scheduler locking — operator-level infrastructure, same audience. */}
          <div className="flex items-center gap-2 mb-2 mt-6 pt-4 border-t border-[var(--line)]">
            <Plug className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
            <h2 className="font-mono font-bold text-sm">Scheduler locking (platform)</h2>
          </div>
          <div className="card text-xs" style={{ background: lock.ok ? "var(--green-soft)" : "var(--amber-soft)" }}>
            <div className="flex items-center gap-2 mb-1">
              {lock.ok
                ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "var(--green)" }} />
                : <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--amber-on)" }} />}
              <b className="font-mono">{lock.backend}</b>
            </div>
            <p className="leading-relaxed" style={{ color: lock.ok ? "var(--green-on)" : "var(--amber-on)" }}>{lock.detail}</p>
            <p className="text-[11px] mt-1.5 text-[var(--mute)] leading-relaxed">
              The background sweeps (autopilot, social publishing, metrics, analytics) each run inside a lock held for
              the whole run. The social one publishes to a real audience, so a double-fire across replicas would post
              twice — set <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>REDIS_URL</code> before scaling past one instance.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
