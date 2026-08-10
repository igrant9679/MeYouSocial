import Link from "next/link";
import {
  Sparkles, PenLine, Telescope, MessageCircle, ArrowRight, Bot, TrendingUp,
  AlertTriangle, Info, Check, ChevronRight, CalendarClock,
} from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { getHomeData, type HomeDecision, type PipelineStage } from "@/lib/home";
import { autopilotFeed, hasSeriesData, homeStats, postPerformance, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart } from "@/components/charts";
import { networkFor } from "@/lib/social/networks";

/**
 * Home = the decision queue, with the pipeline drawn above it.
 *
 * Rebuilt 2026-08-10 because the old dashboard answered "what exists"
 * (channels, scripts, KPIs) while the person opening an autonomous app is
 * asking "what needs me". Order of the page IS the design:
 *
 *   1. The pipeline strip — the workflow made visible, live counts per stage.
 *   2. Needs you — every decision across Social, Blog, Engage and Setup.
 *   3. Coming up / engine activity — what happens next without you.
 *   4. Results — measured numbers only.
 *   5. Start something — the launch points the old quick tiles provided.
 *
 * The queue reuses Social's attention rules: only actionable items, only
 * measured counts, dashes (with reasons) where a number isn't known.
 */

export default async function DashboardPage() {
  const { workspace } = await requireMembership();

  const [home, stats, series, perf, feed, channels] = await Promise.all([
    getHomeData(workspace.id),
    homeStats(workspace.id),
    weeklySeries(workspace.id, 8),
    postPerformance(workspace.id, 5),
    autopilotFeed(workspace.id, 6),
    db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }, take: 6 }),
  ]);

  const warn = home.decisions.filter((d) => d.severity === "warn");
  const info = home.decisions.filter((d) => d.severity === "info");
  const hasAnalytics = hasSeriesData(series);
  const { nextSend, timeZone } = home.social;

  return (
    <div>
      {/* ── Header — a sentence, not a hero ─────────────────────────────── */}
      <div className="flex items-baseline gap-3 mb-4 flex-wrap">
        <h1 className="font-mono text-[22px] font-bold m-0">{workspace.name}</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">
          {warn.length > 0
            ? `${warn.length} thing${warn.length === 1 ? "" : "s"} need${warn.length === 1 ? "s" : ""} you — everything else is running.`
            : "Nothing needs you right now. The engine is running."}
        </p>
      </div>

      {/* ── 1 · Pipeline strip ──────────────────────────────────────────── */}
      <div className="card mb-6 !p-0 overflow-x-auto">
        <div className="flex items-stretch min-w-[720px]">
          {home.pipeline.map((stage, i) => (
            <PipelineCell key={stage.key} stage={stage} first={i === 0} />
          ))}
        </div>
      </div>

      {/* ── 2 · Needs you ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4" style={{ color: warn.length ? "var(--amber-on)" : "var(--green-on)" }} />
        <h2 className="font-mono font-bold text-sm">Needs you</h2>
      </div>
      {warn.length === 0 ? (
        <div className="card text-xs flex items-center gap-2 mb-4" style={{ borderColor: "var(--green)" }}>
          <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} />
          Nothing urgent anywhere — social, blog and inbox are all clear.
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          {warn.map((d) => <DecisionCard key={`${d.module}-${d.kind}`} item={d} />)}
        </div>
      )}

      {info.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
            <h2 className="font-mono font-bold text-sm">Worth a look</h2>
          </div>
          <div className="flex flex-col gap-2 mb-4">
            {info.map((d) => <DecisionCard key={`${d.module}-${d.kind}`} item={d} />)}
          </div>
        </>
      )}

      {/* ── 3 · Coming up · engine activity ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <section className="card">
          <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-1.5">
            <CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Coming up
          </h2>
          {nextSend ? (
            <p className="text-xs text-[var(--slate)] m-0">
              Next send <b className="font-mono">{nextSend.label}</b> ({timeZone}) on{" "}
              {nextSend.providers.map((p) => networkFor(p)?.label ?? p).join(" · ")}.{" "}
              <Link href="/social/calendar" className="underline">Calendar</Link>
            </p>
          ) : (
            <p className="text-xs text-[var(--mute)] m-0">
              Nothing scheduled. <Link href="/social/compose" className="underline">Compose a post</Link>{" "}
              or <Link href="/social/calendar" className="underline">queue a draft</Link>.
            </p>
          )}
          <p className="text-[11px] text-[var(--mute)] mt-2 mb-0">
            {home.social.slotsConfigured
              ? `${home.social.freeSlotsAhead} free slot${home.social.freeSlotsAhead === 1 ? "" : "s"} in the next 7 days`
              : "No posting slots configured yet"}
            {" · "}{home.social.counts.scheduled} scheduled{" · "}{home.social.counts.drafts} social draft{home.social.counts.drafts === 1 ? "" : "s"}
          </p>
        </section>

        <section className="card">
          <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-1.5">
            <Bot className="w-4 h-4" style={{ color: "var(--violet-on)" }} /> What the engine did
          </h2>
          {feed.length === 0 ? (
            <p className="text-xs text-[var(--mute)] m-0">
              Idle — turn on autonomy under <Link href="/blog/automation" className="underline">Blog → Automation</Link>{" "}
              and <Link href="/social/settings" className="underline">Social → Settings</Link>.
            </p>
          ) : (
            <ul className="m-0 p-0 text-xs">
              {feed.map((e, i) => (
                <li key={i} className="border-t border-[var(--line)] first:border-t-0 py-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-[9.5px] text-[var(--mute)] w-20 shrink-0">
                    {e.at.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone })}
                  </span>
                  {e.href ? <Link href={e.href} className="flex-1 hover:underline">{e.label}</Link> : <span className="flex-1">{e.label}</span>}
                  {e.tone === "warn" && (
                    <span className="font-mono text-[9px] font-bold px-1.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>!</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── 4 · Results — measured numbers only ─────────────────────────── */}
      <section className="card mb-6">
        <div className="flex items-center mb-2">
          <h2 className="font-mono text-[15px] font-bold flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
              <TrendingUp className="w-4 h-4" strokeWidth={2.5} />
            </span>
            Results
          </h2>
          <span className="flex-1" />
          <Link href="/social/performance" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline mr-3">social →</Link>
          <Link href="/blog/analytics" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">blog →</Link>
        </div>
        {hasAnalytics ? (
          <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title="Blog impressions — last 8 weeks" />
        ) : (
          <p className="text-sm text-[var(--mute)] py-6 text-center m-0">
            No search analytics yet — numbers appear once snapshots exist under{" "}
            <Link href="/blog/analytics" className="underline">Blog → Analytics</Link>. Charts light up from real data, never invented curves.
          </p>
        )}
        {perf.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[var(--mute)]">
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Post</th>
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Pos</th>
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Δ</th>
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {perf.map((p) => {
                  const delta = p.position != null && p.prevPosition != null ? p.prevPosition - p.position : null;
                  return (
                    <tr key={p.id} className="odd:bg-[var(--zebra)] hover:bg-[var(--blue-soft)] transition-colors">
                      <td className="py-1.5 px-2 border-b border-[var(--line)]">
                        <Link href={`/blog/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
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
        )}
      </section>

      {/* ── 5 · Start something ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-mono font-bold text-sm m-0">Start something</h2>
        <span className="flex-1" />
        {stats.aiBudgetUsedToday > 0 && (
          <span className="text-[10px] font-mono text-[var(--mute)]">{stats.aiBudgetUsedToday} AI runs today</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <QuickTile href="/social/compose" label="Write a social post" icon={PenLine} color="var(--green-on)" soft="var(--green-soft)" />
        <QuickTile href={channels[0] ? `/channels/${channels[0].id}/ideas` : "/onboarding/channel/new"} label="Generate ideas" icon={Sparkles} color="var(--amber-on)" soft="var(--amber-soft)" />
        <QuickTile href="/intel" label="Explore Intel" icon={Telescope} color="var(--blue-on)" soft="var(--blue-soft)" />
        <QuickTile href="/chat" label="Brainstorm chat" icon={MessageCircle} color="var(--violet-on)" soft="var(--violet-soft)" />
      </div>

      {/* Channels strip — the YouTube studio side, still one click away */}
      {channels.length > 0 && (
        <section className="card">
          <div className="flex items-center mb-3">
            <h2 className="font-mono text-[15px] font-bold">Your channels</h2>
            <span className="flex-1" />
            <Link href="/onboarding/channel/new" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">+ new channel</Link>
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
    </div>
  );
}

/**
 * One stage of the pipeline strip.
 *
 * A chevron between cells, drawn with a border, so the strip reads as a flow
 * left-to-right rather than as six unrelated stat tiles — the whole point is
 * that content MOVES through these.
 */
function PipelineCell({ stage, first }: { stage: PipelineStage; first: boolean }) {
  const parts = stage.parts.filter((p) => p.n > 0);
  return (
    <div className={"flex-1 min-w-[120px] px-3 py-2.5 relative " + (first ? "" : "border-l border-[var(--line)]")}>
      <div className="flex items-center gap-1">
        {!first && <ChevronRight className="w-3 h-3 text-[var(--mute)] -ml-1.5 flex-shrink-0" aria-hidden />}
        <Link href={stage.href} className="font-mono text-[9.5px] uppercase tracking-wider text-[var(--mute)] font-bold hover:text-[var(--accent)] hover:underline truncate">
          {stage.label}
        </Link>
      </div>
      {stage.total === null ? (
        // A dash with the reason on hover — an unknown is not a zero.
        <div className="font-mono font-bold text-[22px] leading-tight text-[var(--mute)]" title={stage.reason}>—</div>
      ) : (
        <Link href={stage.href} className="font-mono font-bold text-[22px] leading-tight tabular-nums block hover:text-[var(--accent)]">
          {stage.total.toLocaleString("en-GB")}
        </Link>
      )}
      <div className="flex gap-2 flex-wrap min-h-[14px]">
        {parts.length > 1
          ? parts.map((p) => (
              <Link key={p.label} href={p.href} className="text-[10px] text-[var(--mute)] hover:underline">
                {p.n} {p.label}
              </Link>
            ))
          : null}
      </div>
    </div>
  );
}

function DecisionCard({ item }: { item: HomeDecision }) {
  const warn = item.severity === "warn";
  // Only hues with a full --<hue>-soft / --<hue>-on pair in globals.css —
  // "slate" has neither and renders as unset background/color.
  const HUES: Record<HomeDecision["module"], string> = {
    Social: "violet", Blog: "rose", Engage: "cyan", Setup: "teal",
  };
  const hue = HUES[item.module] ?? "teal";
  return (
    <div className="card flex items-start gap-2.5" style={{ borderColor: warn ? "var(--amber)" : "var(--line)" }}>
      <span className="mt-0.5 flex-shrink-0">
        {warn
          ? <AlertTriangle className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
          : <Info className="w-4 h-4" style={{ color: "var(--blue-on)" }} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          {item.title}
          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
            style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
            {item.module}
          </span>
        </div>
        <div className="text-xs text-[var(--mute)] leading-relaxed">{item.detail}</div>
      </div>
      <Link href={item.href} className="btn sm flex-shrink-0">{item.cta}</Link>
    </div>
  );
}

function QuickTile({ href, label, icon: Icon, color, soft }: { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; color: string; soft: string }) {
  return (
    <Link href={href} className="card flex items-center gap-3 hover:shadow-lg transition group" style={{ borderColor: "var(--line)" }}>
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
