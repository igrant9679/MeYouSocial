import { Plug, Mail, CheckCircle2, AlertTriangle, Star, Trash2, Share2 } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SubmitButton } from "@/components/SubmitButton";
import { unipileConfigured } from "@/lib/unipile";
import {
  connectAccountAction,
  disconnectAccountAction,
  setDefaultAccountAction,
  saveUnipileConfigAction,
} from "@/app/actions/connections";

// Admin → Connections: connect the workspace's own mailboxes and social
// profiles through Unipile (hosted auth). Sending email + posting resolve the
// account stored here. Unipile is what makes email delivery work at all on
// Railway (outbound SMTP is blocked; Unipile is HTTPS).

type SearchParams = { ok?: string; err?: string; connected?: string; failed?: string };

const SOCIALS = [
  { category: "linkedin", label: "LinkedIn", Icon: Share2, color: "#0A66C2" },
  { category: "instagram", label: "Instagram", Icon: Share2, color: "#E1306C" },
  { category: "x", label: "X (Twitter)", Icon: Share2, color: "#111111" },
] as const;

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspace, user } = await requireRole("ADMIN");
  const { ok, err, connected, failed } = await searchParams;

  const configured = await unipileConfigured();
  const isPlatformOperator = Boolean(env.BOOTSTRAP_ADMIN_EMAIL && user.email === env.BOOTSTRAP_ADMIN_EMAIL);
  const accounts = await db.unipileAccount.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });
  const emailAccounts = accounts.filter((a) => a.kind === "email");
  const socialAccounts = accounts.filter((a) => a.kind === "social");

  const cfgRows = isPlatformOperator
    ? await db.setting.findMany({ where: { key: { in: ["unipile:dsn", "unipile:api_key"] } } })
    : [];
  const cfg = new Map(cfgRows.map((r) => [r.key, r.value] as const));

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Plug className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Connections</h1>
          <p className="text-xs text-[var(--mute)]">
            Connect <b>{workspace.name}</b>&apos;s own mailboxes and social profiles. Email notifications send from a
            connected mailbox (over HTTPS — the reliable path on this host); social posts publish from a connected profile.
          </p>
        </div>
      </div>

      {(ok || connected) && (
        <div className="card mb-3 flex items-center gap-2 text-sm" style={{ background: "var(--green-soft)", borderColor: "var(--green)" }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} />
          {connected ? "Account connected — it should appear below within a few seconds." : ok === "disconnected" ? "Account disconnected." : ok === "default" ? "Default account updated." : ok === "config" ? "Unipile settings saved." : "Saved."}
        </div>
      )}
      {(err || failed) && (
        <div className="card mb-3 flex items-center gap-2 text-sm" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--rose-on)" }} />
          {failed ? "Connection was cancelled or failed. Nothing was saved." : err === "unconfigured" ? "Unipile isn't set up yet — the platform operator must add the DSN + API key below." : err === "category" ? "Unknown account type." : err}
        </div>
      )}

      {!configured && (
        <div className="card mb-4 text-sm" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <b>Unipile isn&apos;t configured yet.</b> {isPlatformOperator ? "Add the DSN + API key at the bottom of this page to enable connecting accounts." : "The platform operator needs to add the Unipile DSN + API key before accounts can be connected."}
        </div>
      )}

      {/* Email accounts */}
      <div className="flex items-center gap-2 mb-2 mt-6">
        <Mail className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
        <h2 className="font-mono font-bold text-sm">Email accounts</h2>
      </div>
      <AccountList accounts={emailAccounts} emptyText="No mailbox connected — notifications fall back to the platform sender (or mock)." />
      <form action={connectAccountAction} className="mb-6">
        <input type="hidden" name="category" value="email" />
        <SubmitButton className="btn primary sm" disabled={!configured} pendingText="Opening…">
          <Mail className="w-4 h-4" /> Connect a mailbox (Gmail, Outlook, or any IMAP)
        </SubmitButton>
      </form>

      {/* Social accounts */}
      <div className="flex items-center gap-2 mb-2">
        <Plug className="w-4 h-4" style={{ color: "var(--purple-on)" }} />
        <h2 className="font-mono font-bold text-sm">Social accounts</h2>
      </div>
      <AccountList accounts={socialAccounts} emptyText="No social profile connected — connect one to publish posts from the blog’s Distribute tab." />
      <div className="flex flex-wrap gap-2 mb-8">
        {SOCIALS.map(({ category, label, Icon, color }) => (
          <form key={category} action={connectAccountAction}>
            <input type="hidden" name="category" value={category} />
            <SubmitButton className="btn sm" disabled={!configured} pendingText="Opening…">
              <Icon className="w-4 h-4" style={{ color }} /> Connect {label}
            </SubmitButton>
          </form>
        ))}
      </div>

      {/* Platform operator: Unipile credentials */}
      {isPlatformOperator && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-8 pt-4 border-t border-[var(--line)]">
            <Plug className="w-4 h-4" style={{ color: "var(--purple-on)" }} />
            <h2 className="font-mono font-bold text-sm">Unipile credentials (platform)</h2>
          </div>
          <div className="card mb-3 text-xs text-[var(--mute)] leading-relaxed">
            One Unipile account serves every workspace on this install; each connects its own mailboxes/profiles under it.
            Get the <b>DSN</b> (e.g. <code className="font-mono px-1 rounded" style={{ background: "var(--zebra)" }}>api8.unipile.com:13443</code>) and an
            <b> API key</b> from <a href="https://dashboard.unipile.com/access-tokens" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>dashboard.unipile.com</a>.
          </div>
          <form action={saveUnipileConfigAction} className="card mb-2">
            <input type="hidden" name="setting" value="unipile:dsn" />
            <div className="font-mono font-bold text-sm mb-1">DSN {cfg.get("unipile:dsn") && <span className="text-[10px] font-normal text-[var(--green-on)]">· set</span>}</div>
            <div className="flex gap-2">
              <input name="value" defaultValue={cfg.get("unipile:dsn") ?? ""} placeholder="api8.unipile.com:13443" className="flex-1 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" autoComplete="off" />
              <SubmitButton className="btn primary sm">Save</SubmitButton>
            </div>
          </form>
          <form action={saveUnipileConfigAction} className="card mb-3">
            <input type="hidden" name="setting" value="unipile:api_key" />
            <div className="font-mono font-bold text-sm mb-1">API key {cfg.get("unipile:api_key") && <span className="text-[10px] font-normal text-[var(--green-on)]">· {mask(cfg.get("unipile:api_key")!)}</span>}</div>
            <div className="flex gap-2">
              <input name="value" type="password" placeholder={cfg.get("unipile:api_key") ? "Paste a new key to replace, or empty to clear" : "Paste your Unipile API key"} className="flex-1 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" autoComplete="off" />
              <SubmitButton className="btn primary sm">Save</SubmitButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function AccountList({ accounts, emptyText }: { accounts: { id: string; provider: string; name: string | null; isDefault: boolean }[]; emptyText: string }) {
  if (accounts.length === 0) {
    return <div className="card mb-2 text-xs text-[var(--mute)]">{emptyText}</div>;
  }
  return (
    <ul className="flex flex-col gap-2 mb-3">
      {accounts.map((a) => (
        <li key={a.id} className="card flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--panel)", color: "var(--mute)" }}>{a.provider}</span>
          <span className="text-sm font-semibold truncate">{a.name ?? "(connected account)"}</span>
          {a.isDefault && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
              <Star className="w-3 h-3" /> default
            </span>
          )}
          <span className="flex-1" />
          {!a.isDefault && (
            <form action={setDefaultAccountAction}>
              <input type="hidden" name="id" value={a.id} />
              <button className="btn sm" title="Use this account by default">Make default</button>
            </form>
          )}
          <form action={disconnectAccountAction}>
            <input type="hidden" name="id" value={a.id} />
            <button className="btn sm" title="Disconnect"><Trash2 className="w-3.5 h-3.5" /></button>
          </form>
        </li>
      ))}
    </ul>
  );
}
