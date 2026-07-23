import Link from "next/link";
import { Sparkles, PenLine, Telescope, MessageCircle, Image as ImageIcon, ArrowRight, FileText, Bot, TrendingUp } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { autopilotFeed, hasSeriesData, homeStats, postPerformance, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart, HBars, Sparkline } from "@/components/charts";
import { CountUp } from "@/components/CountUp";

// MU-01 — Dashboard home. Vibrant, color-keyed surfaces matching the mockup palette,
// now with the analytics layer: KPI count-ups, sparklines, impressions chart,
// pipeline bars, performance table, autopilot feed. All charts read real rows.

export default async function DashboardPage() {
  const { workspace, user } = await requireMembership();

  const [blogByStatus, blogIdeasOpen, lastAutopilot, stats, series, perf, feed] = await Promise.all([
    db.blogPost.groupBy({ by: ["status"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
    db.blogIdea.count({ where: { workspaceId: workspace.id, status: { in: ["discovered", "approved"] } } }),
    db.auditLog.findFirst({
      where: { workspaceId: workspace.id, action: { in: ["autopilot.cycle", "autopilot.manual_run"] } },
      orderBy: { createdAt: "desc" },
    }),
    homeStats(workspace.id),
    weeklySeries(workspace.id, 8),
    postPerformance(workspace.id, 6),
    autopilotFeed(workspace.id, 5),
  ]);
  const hasAnalytics = hasSeriesData(series);
  const publishedDelta = stats.publishedThisMonth - stats.publishedLastMonth;
  const blogCount = (s: string) => blogByStatus.find((b) => b.status === s)?._count._all ?? 0;
  const blogTotal = blogByStatus.reduce((a, b) => a + b._count._all, 0);
  const blogNeedsYou = blogCount("draft_review") + blogCount("final_approval");

  const [channelCount, scriptCount, ideaCount, recentScripts, recentIdeas, channels] = await Promise.all([
    db.channel.count({ where: { workspaceId: workspace.id } }),
    db.script.count({ where: { channel: { workspaceId: workspace.id } } }),
    db.idea.count({ where: { channel: { workspaceId: workspace.id } } }),
    db.script.findMany({
      where: { channel: { workspaceId: workspace.id } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { channel: { select: { name: true, accentColor: true } } },
    }),
    db.idea.findMany({
      where: { channel: { workspaceId: workspace.id } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { channel: { select: { name: true, accentColor: true } } },
    }),
    db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const firstName = (user.name ?? user.email).split(/[\s@]/)[0];

  return (
    <div>
      {/* Hero banner */}
      <div className="rounded-[20px] p-7 mb-6 text-white relative overflow-hidden shadow-xl shadow-[#E5482F]/20"
           style={{ background: "linear-gradient(115deg,#E5482F 0%,#B5371F 45%,#6D28D9 100%)" }}>
        {/* Decorative shapes — behind everything else (z-0) */}
        <div className="absolute -right-20 -bottom-28 w-[320px] h-[320px] rounded-full border border-white/15 z-0 pointer-events-none" />
        <div className="absolute right-[35%] -top-32 w-[200px] h-[200px] rounded-full bg-white/5 z-0 pointer-events-none" />

        {/* Foreground content */}
        <div className="relative z-10">
          <h1 className="font-mono text-[28px] font-bold m-0 flex items-center gap-3 leading-tight">
            Welcome back, {firstName} <Sparkles className="w-6 h-6" />
          </h1>
          <p className="opacity-90 text-[14px] mt-1.5 max-w-xl">From idea to first draft in about twelve minutes. Pick up where you left off — or start something new.</p>
        </div>

        <div className="absolute right-6 top-6 flex gap-2 z-10">
          <PillStat label="channels" value={channelCount} />
          <PillStat label="scripts" value={scriptCount} />
          <PillStat label="posts" value={blogTotal} />
          <PillStat label="ideas" value={ideaCount + blogIdeasOpen} />
        </div>
      </div>

      {/* Quick start tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <QuickTile href={`/channels/${channels[0]?.id ?? ""}/ideas`} disabled={!channels[0]} label="Generate ideas" icon={Sparkles} color="var(--amber-on)" soft="var(--amber-soft)" />
        <QuickTile href="/scripts" label="Write a script" icon={PenLine} color="var(--green-on)" soft="var(--green-soft)" />
        <QuickTile href="/intel" label="Explore Intel" icon={Telescope} color="var(--blue-on)" soft="var(--blue-soft)" />
        <QuickTile href="/chat" label="Brainstorm chat" icon={MessageCircle} color="var(--violet-on)" soft="var(--violet-soft)" />
      </div>

      {/* KPI band — count-ups + sparklines, all from real rows */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card anim-rise ad-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">Published this month</div>
          <div className="font-mono font-bold text-[26px] leading-tight tabular-nums"><CountUp value={stats.publishedThisMonth} /></div>
          <div className="text-[11px] font-semibold" style={{ color: publishedDelta >= 0 ? "var(--green-on)" : "var(--rose-on)" }}>
            {publishedDelta >= 0 ? "▲" : "▼"} {publishedDelta >= 0 ? "+" : ""}{publishedDelta} vs last month
          </div>
        </div>
        <div className="card anim-rise ad-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">Clicks this week</div>
          <div className="font-mono font-bold text-[26px] leading-tight tabular-nums"><CountUp value={stats.clicksThisWeek} /></div>
          {hasAnalytics ? (
            <Sparkline points={series.map((p) => p.clicks)} color="var(--teal)" />
          ) : (
            <div className="text-[11px] text-[var(--mute)]">no snapshots yet</div>
          )}
        </div>
        <div className="card anim-rise ad-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">Avg position</div>
          <div className="font-mono font-bold text-[26px] leading-tight tabular-nums">
            {stats.avgPosition != null ? <CountUp value={stats.avgPosition} decimals={1} /> : "—"}
          </div>
          <div className="text-[11px] text-[var(--mute)]">{stats.avgPosition != null ? "lower is better" : "add snapshots under Blog → Analytics"}</div>
        </div>
        <div className="card anim-rise ad-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">Waiting on you</div>
          <div className="font-mono font-bold text-[26px] leading-tight tabular-nums" style={blogNeedsYou > 0 ? { color: "var(--amber-on)" } : undefined}>
            <CountUp value={blogNeedsYou} />
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {stats.unverifiedCitations > 0 && (
              <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                {stats.unverifiedCitations} citations
              </span>
            )}
            {stats.postsMissingAssets > 0 && (
              <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                {stats.postsMissingAssets} missing images
              </span>
            )}
            {stats.unverifiedCitations === 0 && stats.postsMissingAssets === 0 && (
              <span className="text-[11px] text-[var(--mute)]">no blockers</span>
            )}
          </div>
        </div>
      </div>

      {/* Analytics band: impressions chart + pipeline & autopilot */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3 mb-4">
        <section className="card anim-rise ad-3">
          <div className="flex items-center mb-2">
            <h2 className="font-mono text-[15px] font-bold flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
                <TrendingUp className="w-4 h-4" strokeWidth={2.5} />
              </span>
              Impressions — last 8 weeks
            </h2>
            <span className="flex-1" />
            <Link href="/blog/analytics" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">analytics →</Link>
          </div>
          {hasAnalytics ? (
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title="Impressions" />
          ) : (
            <p className="text-sm text-[var(--mute)] py-10 text-center">
              No analytics snapshots yet. Add weekly numbers under <Link href="/blog/analytics" className="underline">Blog → Analytics</Link> —
              charts light up from real data, never invented curves.
            </p>
          )}
        </section>
        <div className="flex flex-col gap-3">
          <section className="card anim-rise ad-4">
            <h2 className="font-mono text-[13px] font-bold mb-2">Pipeline</h2>
            <HBars
              rows={[
                { label: "Ideas open", value: blogIdeasOpen, color: "var(--cyan)" },
                { label: "Drafting", value: blogCount("drafting"), color: "var(--amber)" },
                { label: "In review", value: blogCount("draft_review"), color: "var(--blue)" },
                { label: "Approval", value: blogCount("final_approval"), color: "var(--violet)" },
                { label: "Published", value: blogCount("published"), color: "var(--green)" },
              ]}
            />
          </section>
          <section className="card anim-rise ad-5 flex-1">
            <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-1.5"><Bot className="w-4 h-4" style={{ color: "var(--violet-on)" }} /> Autopilot activity</h2>
            {feed.length === 0 ? (
              <p className="text-xs text-[var(--mute)]">Idle — set modes under <Link href="/blog/automation" className="underline">Blog → Automation</Link>.</p>
            ) : (
              <ul className="m-0 p-0 text-xs">
                {feed.map((e, i) => (
                  <li key={i} className="border-t border-[var(--line)] first:border-t-0 py-1.5 flex items-baseline gap-2">
                    <span className="font-mono text-[9.5px] text-[var(--mute)] w-9 shrink-0">
                      {e.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="flex-1">{e.label}</span>
                    {e.tone === "warn" && <span className="font-mono text-[9px] font-bold px-1.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>!</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Content performance table */}
      <section className="card mb-6 anim-rise ad-5">
        <div className="flex items-center mb-2">
          <h2 className="font-mono text-[15px] font-bold">Content performance</h2>
          <span className="flex-1" />
          <Link href="/blog/report" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">full report →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--mute)]">
                <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Post</th>
                <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Stage</th>
                <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Pos</th>
                <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Δ</th>
                <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {perf.map((p) => {
                const delta = p.position != null && p.prevPosition != null ? p.prevPosition - p.position : null;
                const meta = STAGE_META[p.status] ?? { label: p.status, hue: "cyan" };
                return (
                  <tr key={p.id} className="odd:bg-[var(--zebra)] hover:bg-[var(--blue-soft)] transition-colors">
                    <td className="py-1.5 px-2 border-b border-[var(--line)]">
                      <Link href={`/blog/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                    </td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)]">
                      <span className="font-mono text-[9.5px] font-bold px-2 py-0.5 rounded-full" style={{ background: `var(--${meta.hue}-soft)`, color: `var(--${meta.hue}-on)` }}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{p.position?.toFixed(1) ?? "—"}</td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums font-bold" style={{ color: delta == null ? "var(--mute)" : delta >= 0 ? "var(--green-on)" : "var(--rose-on)" }}>
                      {delta == null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}`}
                    </td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{p.clicks ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Blog pipeline (Wave A′ — the blog side is first-class on Home now) */}
      <section className="card mb-6">
        <div className="flex items-center mb-3">
          <h2 className="font-mono text-[15px] font-bold flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
              <FileText className="w-4 h-4" strokeWidth={2.5} />
            </span>
            Blog pipeline
          </h2>
          <span className="flex-1" />
          <Link href="/blog" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">open blog →</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {[
            { label: "drafting", n: blogCount("drafting"), hue: "amber" },
            { label: "in review", n: blogCount("draft_review"), hue: "blue" },
            { label: "approval", n: blogCount("final_approval"), hue: "violet" },
            { label: "published", n: blogCount("published"), hue: "green" },
            { label: "open ideas", n: blogIdeasOpen, hue: "cyan" },
          ].map((s) => (
            <span key={s.label} className="font-mono text-xs px-2.5 py-1 rounded-full" style={{ background: `var(--${s.hue}-soft)`, color: `var(--${s.hue}-on)` }}>
              {s.label} <b>{s.n}</b>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--mute)]">
          {blogNeedsYou > 0 ? (
            <Link href="/blog/board" className="underline" style={{ color: "var(--amber-on)" }}>
              {blogNeedsYou} post{blogNeedsYou === 1 ? "" : "s"} waiting on you
            </Link>
          ) : (
            <span>Nothing waiting on review.</span>
          )}
          <span className="flex items-center gap-1">
            <Bot className="w-3.5 h-3.5" />
            {lastAutopilot
              ? `autopilot: last activity ${lastAutopilot.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
              : "autopilot idle — set modes under Blog → Automation"}
          </span>
        </div>
      </section>

      {/* Channels strip */}
      {channels.length > 0 && (
        <section className="card mb-6">
          <div className="flex items-center mb-3">
            <h2 className="font-mono text-[15px] font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4" style={{ color: "var(--accent-on)" }} /> Your channels</h2>
            <span className="flex-1" />
            <Link href="/onboarding/channel/new" className="text-xs font-mono text-[var(--accent)] font-semibold flex items-center gap-1 hover:underline">+ new channel</Link>
          </div>
          <div className="flex gap-3 flex-wrap">
            {channels.map((c) => (
              <Link key={c.id} href={`/channels/${c.id}`} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[var(--line)] hover:border-[var(--accent)] hover:shadow-md transition group">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white font-mono font-bold text-sm" style={{ background: c.accentColor ?? "var(--accent)" }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{c.name}</span>
                  <span className="text-[11px] text-[var(--mute)]">{c.presentationStyle ?? "—"} · {c.defaultLanguage}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-[var(--mute)] group-hover:text-[var(--accent)] ml-1" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Two-column: recent scripts + latest ideas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="font-mono text-[15px] font-bold mb-3 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}><PenLine className="w-4 h-4" strokeWidth={2.5} /></span>
            Recent scripts
          </h2>
          {recentScripts.length === 0 && <EmptyHint label="No scripts yet" cta={{ href: "/scripts", text: "Start a script" }} />}
          <ul className="m-0 p-0">
            {recentScripts.map((s) => (
              <li key={s.id} className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl grid place-items-center font-mono text-[11px] font-bold text-white shadow-sm" style={{ background: s.channel.accentColor ?? "var(--accent)" }}>{s.channel.name.slice(0, 2).toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{s.title}</div>
                  <div className="text-xs text-[var(--mute)]">{s.channel.name} · {s.wordCount} words · {s.status}</div>
                </div>
                <Link href={`/scripts/${s.id}`} className="btn sm">Open</Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="font-mono text-[15px] font-bold mb-3 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}><Sparkles className="w-4 h-4" strokeWidth={2.5} /></span>
            Latest ideas
          </h2>
          {recentIdeas.length === 0 && <EmptyHint label="No ideas yet" cta={{ href: channels[0] ? `/channels/${channels[0].id}/ideas` : "/onboarding/channel/new", text: "Generate ideas" }} />}
          <ul className="m-0 p-0">
            {recentIdeas.map((i) => (
              <li key={i.id} className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3">
                <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md" style={{ background: outlierColor(i.outlierScore ?? 0).soft, color: outlierColor(i.outlierScore ?? 0).color }}>
                  {i.outlierScore?.toFixed(1) ?? "—"}x
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{i.title}</div>
                  <div className="text-xs text-[var(--mute)]">{i.channel.name} · {i.suggestedLength ?? "—"}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const STAGE_META: Record<string, { label: string; hue: string }> = {
  drafting: { label: "Drafting", hue: "amber" },
  draft_review: { label: "Review", hue: "blue" },
  final_approval: { label: "Approval", hue: "violet" },
  published: { label: "Published", hue: "green" },
};

function PillStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/15 border border-white/25 backdrop-blur-sm rounded-xl px-3.5 py-2 text-center min-w-[68px]">
      <div className="font-mono font-bold text-lg leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-80 mt-0.5">{label}</div>
    </div>
  );
}

function QuickTile({ href, label, icon: Icon, color, soft, disabled }: { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; color: string; soft: string; disabled?: boolean }) {
  const cls = "card flex items-center gap-3 hover:shadow-lg transition group " + (disabled ? "opacity-40 pointer-events-none" : "");
  return (
    <Link href={href} className={cls} style={{ borderColor: "var(--line)" }}>
      <span className="w-11 h-11 rounded-xl grid place-items-center group-hover:scale-105 transition" style={{ background: soft, color }}>
        <Icon className="w-5 h-5" strokeWidth={2.25} />
      </span>
      <div className="flex-1">
        <div className="font-semibold text-sm leading-tight">{label}</div>
        <div className="text-[11px] text-[var(--mute)] flex items-center gap-1">go <ArrowRight className="w-3 h-3" /></div>
      </div>
    </Link>
  );
}

function EmptyHint({ label, cta }: { label: string; cta: { href: string; text: string } }) {
  return (
    <div className="text-sm text-[var(--mute)] py-8 text-center">
      <div className="mb-3">{label}</div>
      <Link href={cta.href} className="btn primary sm">{cta.text}</Link>
    </div>
  );
}

function outlierColor(score: number): { color: string; soft: string } {
  if (score >= 5) return { color: "var(--brand-on)", soft: "var(--brand-soft)" };
  if (score >= 2) return { color: "var(--amber-on)", soft: "var(--amber-soft)" };
  if (score >= 1) return { color: "var(--blue-on)", soft: "var(--blue-soft)" };
  return { color: "var(--mute)", soft: "var(--zebra)" };
}
