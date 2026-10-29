import { KeyRound } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { revokeApiTokenAction } from "@/app/actions/api-tokens";
import { CreateTokenForm } from "@/components/CreateTokenForm";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";

// Settings → API tokens (E-SEC-16): the workspace's tokens for /api/v1 — who
// made each, what it can do, when it was last used — and Revoke. The token is
// shown once, when it's made; only a hash is kept.

export default async function ApiTokensPage() {
  const { workspace } = await requireRole("ADMIN");
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const tokens = await db.apiToken.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 100 });
  const makers = await db.user.findMany({ where: { id: { in: [...new Set(tokens.map((t) => t.createdById).filter((x): x is string => !!x))] } }, select: { id: true, name: true, email: true } });
  const nameOf = new Map(makers.map((u) => [u.id, u.name ?? u.email]));
  return (
    <main className="w-full max-w-4xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <KeyRound className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">API tokens</h1>
          <p className="text-xs text-[var(--mute)] m-0">For other tools calling {workspace.name}&apos;s API (/api/v1). A read token lists; a read-and-write token can also create drafts, as the admin who made it.</p>
        </div>
      </div>
      <CreateTokenForm />
      {tokens.length === 0 ? (
        <EmptyState line="No API tokens yet." note="Nothing outside the app can call this workspace's API until an admin makes one." action={null} />
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--mute)]">
                {["Name", "Token", "Can", "Made", "Last used", ""].map((h, i) => <th key={i} className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-[var(--line)] last:border-0 align-top" style={t.revokedAt ? { opacity: 0.55 } : undefined}>
                  <td className="py-1.5 px-2 font-semibold">{t.name}</td>
                  <td className="py-1.5 px-2 font-mono">{t.prefix}…</td>
                  <td className="py-1.5 px-2">{t.scope === "write" ? "read and write" : "read"}</td>
                  <td className="py-1.5 px-2">{formatZonedMoment(t.createdAt, tz)}<span className="block text-[10px] text-[var(--mute)]">by {t.createdById ? nameOf.get(t.createdById) ?? "someone who left" : "—"}</span></td>
                  <td className="py-1.5 px-2">{t.lastUsedAt ? formatZonedMoment(t.lastUsedAt, tz) : <span className="text-[var(--mute)]">never</span>}</td>
                  <td className="py-1.5 px-2 text-right">
                    {t.revokedAt ? (
                      <span className="text-[10px] text-[var(--mute)]">revoked {formatZonedMoment(t.revokedAt, tz)}</span>
                    ) : (
                      <form action={revokeApiTokenAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <SubmitButton className="btn sm" pendingText="…">Revoke</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
