import { BarChart3, Users, Sparkles, PenLine, Image as ImageIcon, Bot } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { formatNum } from "@/lib/intel";

// FR-ADMIN-04 — Usage dashboard: generations, active users, scripts created, soft-limit progress.

export default async function AdminUsagePage() {
  const { workspace } = await requireRole("ADMIN");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

  const [activeUsers, scriptsThisMonth, thumbnailsThisMonth, agentRunsThisMonth, totalChannels, totalScripts, recentUsageLogs] = await Promise.all([
    db.user.count({ where: { memberships: { some: { workspaceId: workspace.id, status: "active" } }, lastActivityAt: { gte: weekStart } } }),
    db.script.count({ where: { channel: { workspaceId: workspace.id }, createdAt: { gte: monthStart } } }),
    db.thumbnail.count({ where: { channel: { workspaceId: workspace.id }, createdAt: { gte: monthStart } } }),
    db.agentRun.count({ where: { script: { channel: { workspaceId: workspace.id } }, startedAt: { gte: monthStart } } }),
    db.channel.count({ where: { workspaceId: workspace.id } }),
    db.script.count({ where: { channel: { workspaceId: workspace.id } } }),
    db.usageLog.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 15, include: { } }),
  ]);

  // Compute per-user generation counts this month (top 5)
  const byUser = await db.script.groupBy({
    by: ["authorId"],
    where: { channel: { workspaceId: workspace.id }, createdAt: { gte: monthStart } },
    _count: { _all: true },
  });
  const topUserIds = byUser.filter((b) => b.authorId).sort((a, b) => b._count._all - a._count._all).slice(0, 5);
  const topUsers = await db.user.findMany({ where: { id: { in: topUserIds.map((u) => u.authorId!) } }, select: { id: true, name: true, email: true } });

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E0F2E8", color: "#15924B" }}>
          <BarChart3 className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Usage</h1>
          <p className="text-xs text-[var(--mute)]">This month + soft-limit progress. Never paid.</p>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Tile label="Active users (week)" value={String(activeUsers)} color="#E5482F" soft="#FDE7E1" icon={<Users className="w-4 h-4" />} />
        <Tile label="Channels"            value={String(totalChannels)} color="#6D28D9" soft="#EDE7FB" icon={<Sparkles className="w-4 h-4" />} />
        <Tile label="Scripts / month"     value={String(scriptsThisMonth)}    cap={workspace.limitScriptsPerUserMonth}    color="#15924B" soft="#E0F2E8" icon={<PenLine className="w-4 h-4" />} />
        <Tile label="Thumbnails / month"  value={String(thumbnailsThisMonth)} cap={workspace.limitThumbnailsPerUserMonth} color="#DB2777" soft="#FBE2EF" icon={<ImageIcon className="w-4 h-4" />} />
        <Tile label="Agent runs / month"  value={String(agentRunsThisMonth)}  cap={workspace.limitAgentRunsPerUserMonth}  color="#0D9488" soft="#D7F1ED" icon={<Bot className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top users */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Top creators this month</h2>
          {topUserIds.length === 0 ? (
            <p className="text-xs text-[var(--mute)] py-2">No scripts created yet this month.</p>
          ) : (
            <ul className="m-0 p-0">
              {topUserIds.map((u, i) => {
                const user = topUsers.find((t) => t.id === u.authorId);
                if (!user) return null;
                return (
                  <li key={u.authorId} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 text-sm">
                    <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-mono font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{i + 1}</span>
                    <span className="flex-1">{user.name ?? user.email}</span>
                    <span className="text-xs font-mono text-[var(--mute)]">{u._count._all} scripts</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-[var(--mute)] mt-2 font-mono">{formatNum(totalScripts)} total scripts in this workspace.</p>
        </section>

        {/* Recent activity */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Recent activity</h2>
          {recentUsageLogs.length === 0 ? (
            <p className="text-xs text-[var(--mute)] py-2">No tracked activity yet.</p>
          ) : (
            <ul className="m-0 p-0">
              {recentUsageLogs.map((log) => (
                <li key={log.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-xs flex items-center gap-2">
                  <span className="font-mono uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{log.action}</span>
                  <span className="flex-1">{log.model ?? "—"}</span>
                  <span className="text-[var(--mute)]">{new Date(log.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, cap, color, soft, icon }: { label: string; value: string; cap?: number | null; color: string; soft: string; icon: React.ReactNode }) {
  const v = Number(value);
  const capNum = cap ?? 0;
  const pct = capNum > 0 ? Math.min(100, Math.round((v / capNum) * 100)) : 0;
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="font-mono font-bold text-2xl mt-1" style={{ color }}>{value}{cap ? <span className="text-[11px] text-[var(--mute)] font-normal"> / {cap}</span> : null}</div>
      {capNum > 0 && (
        <div className="h-1 mt-2 rounded-full bg-[var(--line)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: pct + "%", background: pct > 80 ? "var(--brand)" : color }} />
        </div>
      )}
    </div>
  );
}
