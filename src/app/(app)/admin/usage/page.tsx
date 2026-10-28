import { formatZonedMoment } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";
import Link from "next/link";
import { BarChart3, Users, Sparkles, PenLine, Image as ImageIcon, Bot, FileText, Share2, Gauge } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { formatNum } from "@/lib/intel";
import { youtubeUnitsSince } from "@/lib/youtube";
import { AGENT_RUN_ACTION, THUMBNAIL_ACTIONS, monthStartUtc } from "@/lib/soft-limits";
import { PROVIDER_LABEL, modelLabel } from "@/lib/llm/models";

// Usage: what this workspace made this month (UTC), what each AI provider was
// asked for, and the soft limits. The limits cap each PERSON, so they're shown
// against the busiest person, not the workspace's total (audit SET-02).

const PROVIDER_NAME: Record<string, string> = { ...PROVIDER_LABEL, openai: "OpenAI", mock: "Placeholder" };

export default async function AdminUsagePage() {
  const { workspace } = await requireRole("ADMIN");
  const ws = workspace.id;
  const postingTz = await getPostingTimeZone(ws);
  const now = new Date();
  const monthStart = monthStartUtc(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

  // YouTube Data API units this workspace spent (IDE-13): the daily pool is the
  // key's Cloud project's, which several tenants may share. UTC days — Google's
  // quota resets at midnight Pacific, so this is a guide, not their counter.
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [ytToday, ytMonth] = await Promise.all([youtubeUnitsSince(ws, dayStart), youtubeUnitsSince(ws, monthStart)]);
  const month = { gte: monthStart };
  const [activeUsers, totalChannels, articles, socialPosts, scripts, thumbnails, agentRuns, totalScripts, aiRows, firstAiRow, recentUsageLogs] = await Promise.all([
    db.user.count({ where: { memberships: { some: { workspaceId: ws, status: "active" } }, lastActivityAt: { gte: weekStart } } }),
    db.channel.count({ where: { workspaceId: ws } }),
    db.blogPost.count({ where: { workspaceId: ws, createdAt: month } }),
    db.socialPost.count({ where: { workspaceId: ws, createdAt: month } }),
    db.script.count({ where: { channel: { workspaceId: ws }, createdAt: month } }),
    db.thumbnail.count({ where: { channel: { workspaceId: ws }, createdAt: month } }),
    db.agentRun.count({ where: { script: { channel: { workspaceId: ws } }, startedAt: month } }),
    db.script.count({ where: { channel: { workspaceId: ws } } }),
    // Every AI call is metered by the routers (lib/usage-meter.ts).
    db.usageLog.groupBy({
      by: ["action", "provider", "model"],
      where: { workspaceId: ws, action: { in: ["ai.text", "ai.image"] }, createdAt: month },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.usageLog.findFirst({ where: { workspaceId: ws, action: { in: ["ai.text", "ai.image"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    // The metered rows are summed above, not listed one by one.
    db.usageLog.findMany({ where: { workspaceId: ws, action: { notIn: ["youtube.api", "ai.text", "ai.image"] } }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  // Per person this month — what the soft limits count (lib/soft-limits.ts).
  const [scriptsBy, thumbsBy, runsBy] = await Promise.all([
    db.script.groupBy({ by: ["authorId"], where: { channel: { workspaceId: ws }, createdAt: month, authorId: { not: null } }, _count: { _all: true } }),
    db.usageLog.groupBy({ by: ["actorId"], where: { workspaceId: ws, action: { in: THUMBNAIL_ACTIONS }, createdAt: month, actorId: { not: null } }, _count: { _all: true } }),
    db.usageLog.groupBy({ by: ["actorId"], where: { workspaceId: ws, action: AGENT_RUN_ACTION, createdAt: month, actorId: { not: null } }, _count: { _all: true } }),
  ]);
  const ranked = (rows: { id: string | null; n: number }[]) => rows.filter((r) => r.id).sort((a, b) => b.n - a.n);
  const scriptRank = ranked(scriptsBy.map((r) => ({ id: r.authorId, n: r._count._all })));
  const limits = [
    { label: "Scripts", cap: workspace.limitScriptsPerUserMonth, top: scriptRank[0] ?? null },
    { label: "Thumbnail sets", cap: workspace.limitThumbnailsPerUserMonth, top: ranked(thumbsBy.map((r) => ({ id: r.actorId, n: r._count._all })))[0] ?? null },
    { label: "Agent Mode runs", cap: workspace.limitAgentRunsPerUserMonth, top: ranked(runsBy.map((r) => ({ id: r.actorId, n: r._count._all })))[0] ?? null },
  ];
  const personIds = [...new Set([...scriptRank.slice(0, 5), ...limits.map((l) => l.top)].flatMap((r) => (r?.id ? [r.id] : [])))];
  const people = await db.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, email: true } });
  const who = (id: string | null | undefined) => { const u = people.find((p) => p.id === id); return u ? u.name ?? u.email : "someone"; };

  const ai = [...aiRows].sort((a, b) => (a.action === b.action ? b._count._all - a._count._all : a.action === "ai.text" ? -1 : 1));
  const imagesRendered = aiRows.filter((r) => r.action === "ai.image" && r.provider !== "mock").reduce((n, r) => n + r._count._all, 0);
  const placeholders = aiRows.filter((r) => r.provider === "mock").reduce((n, r) => n + r._count._all, 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E0F2E8", color: "#15924B" }}>
          <BarChart3 className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg leading-tight">Usage</h1>
          <p className="text-xs text-[var(--mute)]">This month (UTC, from the 1st), what each AI provider was asked for, and the soft limits. Never paid.</p>
        </div>
        <Link href="/admin/limits" className="btn text-xs"><Gauge className="w-3.5 h-3.5" /> Soft limits</Link>
      </div>

      {/* This month, workspace totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Tile label="Active users (week)" value={activeUsers} color="#E5482F" icon={<Users className="w-4 h-4" />} />
        <Tile label="Channels" value={totalChannels} cap={workspace.limitChannels} color="#6D28D9" icon={<Sparkles className="w-4 h-4" />} />
        <Tile label="Articles / month" value={articles} color="#2563EB" icon={<FileText className="w-4 h-4" />} />
        <Tile label="Social posts / month" value={socialPosts} color="#0891B2" icon={<Share2 className="w-4 h-4" />} />
        <Tile label="AI images / month" value={imagesRendered} color="#D97706" icon={<ImageIcon className="w-4 h-4" />} />
        <Tile label="Scripts / month" value={scripts} color="#15924B" icon={<PenLine className="w-4 h-4" />} />
        <Tile label="Thumbnail sets / month" value={thumbnails} color="#DB2777" icon={<ImageIcon className="w-4 h-4" />} />
        <Tile label="Agent runs / month" value={agentRuns} color="#0D9488" icon={<Bot className="w-4 h-4" />} />
      </div>

      <p className="text-xs text-[var(--mute)] mb-4">
        YouTube Data API: <b className="font-mono">{ytToday.toLocaleString("en-GB")}</b> units today (UTC) · <b className="font-mono">{ytMonth.toLocaleString("en-GB")}</b>{" "}this month.
        A channel search costs 100, every other read 1; the key&apos;s daily pool (10,000 by default) may be shared with other workspaces.
      </p>

      {/* AI by provider */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[14px] mb-1">AI by provider this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-3">
          {firstAiRow
            ? <>Counted from {firstAiRow.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}; calls before then weren&apos;t recorded. </>
            : <>Nothing recorded yet — every AI call is counted from now on. </>}
          Tokens are what the providers bill by; their prices are on each provider&apos;s billing page. A streamed reply reports no tokens.
          {placeholders > 0 && <> <b style={{ color: "var(--rose-on)" }}>{placeholders} placeholder {placeholders === 1 ? "reply" : "replies"}</b> — no key resolved, or the provider failed and the stand-in answered.</>}
        </p>
        {ai.length === 0 ? (
          <p className="text-xs text-[var(--mute)] py-2">No AI calls this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
                  <th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">Provider</th><th className="py-1 pr-3">Model</th>
                  <th className="py-1 pr-3 text-right">Calls</th><th className="py-1 pr-3 text-right">Tokens in</th><th className="py-1 text-right">Tokens out</th>
                </tr>
              </thead>
              <tbody>
                {ai.map((r) => (
                  <tr key={`${r.action}:${r.provider}:${r.model}`} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-3">{r.action === "ai.image" ? "Image" : "Text"}</td>
                    <td className="py-1.5 pr-3">{PROVIDER_NAME[r.provider ?? ""] ?? r.provider ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.action === "ai.text" && r.model ? modelLabel(r.model) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r._count._all.toLocaleString("en-GB")}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r._sum.inputTokens != null ? r._sum.inputTokens.toLocaleString("en-GB") : "—"}</td>
                    <td className="py-1.5 text-right font-mono">{r._sum.outputTokens != null ? r._sum.outputTokens.toLocaleString("en-GB") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Soft limits, per person */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[14px] mb-1">Soft limits this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-3">
          Each limit caps one person; the busiest person is shown against it. Someone at a limit is told so when they try to start another.{" "}
          <Link href="/admin/limits" className="underline">Change the limits</Link>
        </p>
        <ul className="m-0 p-0">
          {limits.map((l) => {
            const n = l.top?.n ?? 0;
            const pct = l.cap ? Math.min(100, Math.round((n / l.cap) * 100)) : 0;
            return (
              <li key={l.label} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="flex-1">{l.label} per person</span>
                  <span className="text-xs font-mono text-[var(--mute)]">
                    {l.top ? `${who(l.top.id)}: ${n}` : "nobody yet"}{l.cap ? ` of ${l.cap}` : " · no limit"}
                  </span>
                </div>
                {l.cap ? (
                  <div className="h-1 mt-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: pct + "%", background: pct >= 100 ? "var(--rose)" : pct > 80 ? "var(--brand)" : "var(--green)" }} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top users */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Top creators this month</h2>
          {scriptRank.length === 0 ? (
            <p className="text-xs text-[var(--mute)] py-2">No scripts created yet this month.</p>
          ) : (
            <ul className="m-0 p-0">
              {scriptRank.slice(0, 5).map((u, i) => (
                <li key={u.id} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-mono font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{i + 1}</span>
                  <span className="flex-1">{who(u.id)}</span>
                  <span className="text-xs font-mono text-[var(--mute)]">{u.n} scripts</span>
                </li>
              ))}
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
                  <span className="text-[var(--mute)]">{formatZonedMoment(new Date(log.createdAt), postingTz)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, cap, color, icon }: { label: string; value: number; cap?: number | null; color: string; icon: React.ReactNode }) {
  const pct = cap ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="font-mono font-bold text-2xl mt-1" style={{ color }}>{value.toLocaleString("en-GB")}{cap ? <span className="text-[11px] text-[var(--mute)] font-normal"> / {cap}</span> : null}</div>
      {cap ? (
        <div className="h-1 mt-2 rounded-full bg-[var(--line)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: pct + "%", background: pct > 80 ? "var(--brand)" : color }} />
        </div>
      ) : null}
    </div>
  );
}
