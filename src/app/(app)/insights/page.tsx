import Link from "next/link";
import { LineChart, TrendingUp, Info } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { collectWorkspaceMetrics, type Metric, type Confidence } from "@/lib/metrics";

// Insights — the read-only face of the metrics spine (src/lib/metrics).
//
// Everything here comes from data the workspace already owns, so it works with
// no external connectors. The one rule the UI must never break: a metric with
// no data renders as “—” plus its reason, never as 0, and a low-confidence
// number is visibly labelled rather than presented as fact.

const RANGE_DAYS = 90;

const CONF_HUE: Record<Confidence, string> = {
  none: "slate",
  low: "amber",
  medium: "blue",
  high: "green",
};

function formatValue(m: Metric): string {
  if (m.value === null) return "—";
  if (m.unit === "percent") return `${m.value}%`;
  if (m.unit === "days") return `${m.value}d`;
  return String(m.value);
}

function MetricCard({ m }: { m: Metric }) {
  const hasData = m.value !== null;
  // A count is exact, so its confidence badge would be noise; only flag the
  // reliability of rates and medians, where sample size actually matters.
  const showConfidence = hasData && m.unit !== "count" && m.confidence !== "high";
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <span className="text-[11px] text-[var(--mute)] flex-1 leading-tight">{m.label}</span>
        {m.source !== "owned" && (
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--zebra)", color: "var(--mute)" }}>
            {m.source}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono font-bold ${hasData ? "text-2xl" : "text-xl text-[var(--mute)]"}`}>{formatValue(m)}</span>
        {showConfidence && (
          <span
            className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: `var(--${CONF_HUE[m.confidence]}-soft)`, color: `var(--${CONF_HUE[m.confidence]}-on)` }}
            title="Confidence reflects how many items this number was computed from."
          >
            {m.confidence} confidence
          </span>
        )}
      </div>
      <p className="text-[10px] text-[var(--mute)] leading-snug">{m.evidence}</p>
    </div>
  );
}

export default async function InsightsPage() {
  const { workspace } = await requireMembership();
  const data = await collectWorkspaceMetrics(workspace.id, RANGE_DAYS);

  const byKey = new Map(data.metrics.map((m) => [m.key, m]));
  const pick = (...keys: string[]) => keys.map((k) => byKey.get(k)).filter((m): m is Metric => Boolean(m));

  const pipeline = pick("posts_published", "idea_approval_rate", "idea_to_draft_rate", "cycle_time_days");
  const momentum = pick("weekly_cadence", "cadence_trend", "wip_open", "wip_stalled");
  const distribution = pick("social_follow_through", "video_follow_through", "ai_generations", "generations_per_publish");
  const performance = pick("search_clicks", "search_impressions", "avg_position", "sessions");

  const maxFunnel = Math.max(1, ...data.funnel.map((s) => s.count));
  const maxWeek = Math.max(1, ...data.cadence.map((p) => p.published));
  const hasPerformance = performance.some((m) => m.value !== null);

  return (
    <main className="w-full">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
          <LineChart className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight">Insights</h1>
          <p className="text-xs text-[var(--mute)]">
            What this workspace actually produced, {data.range.label}. Computed from your own content — no external
            connectors required. A dash means <b>no data</b>, never zero.
          </p>
        </div>
      </div>

      {data.empty && (
        <div className="card mb-4 text-sm">
          Nothing to measure yet. Capture some ideas and publish a post, and this page fills in on its own —
          <Link href="/ideas" className="underline"> start with Ideas</Link>.
        </div>
      )}

      {/* Pipeline */}
      <h2 className="font-mono text-[13px] font-bold mt-4 mb-2">Pipeline</h2>
      <div className="card mb-3">
        <div className="flex flex-col gap-2">
          {data.funnel.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="text-[11px] text-[var(--mute)] w-36 shrink-0">{s.label}</span>
              <div className="flex-1 h-5 rounded-lg bg-[var(--panel)] overflow-hidden">
                <div
                  className="h-full rounded-lg anim-grow"
                  style={{ width: `${Math.max(2, (s.count / maxFunnel) * 100)}%`, background: "var(--accent)" }}
                />
              </div>
              <span className="font-mono text-xs font-bold tabular-nums w-8 text-right">{s.count}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[var(--mute)] mt-2">
          Counts of items that entered each stage in the window. Stages aren&apos;t a strict cohort — an idea captured
          before this window can still publish inside it.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-3 mb-4">
        {pipeline.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>

      {/* Momentum */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Momentum</h2>
      <div className="card mb-3">
        <div className="flex items-end gap-1 h-20">
          {data.cadence.map((p) => (
            <div key={p.weekStart} className="flex-1 flex flex-col justify-end items-center gap-1" title={`Week of ${p.weekStart}: ${p.published} published`}>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${(p.published / maxWeek) * 100}%`,
                  minHeight: p.published ? "4px" : "2px",
                  background: p.published ? "var(--green)" : "var(--line)",
                }}
              />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[var(--mute)] mt-1.5 flex items-center gap-1">
          <TrendingUp className="w-3 h-3" /> Posts published per week, last 12 weeks.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-3 mb-3">
        {momentum.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>
      {data.wip.length > 0 && (
        <div className="card mb-4">
          <h3 className="font-mono text-[11px] font-bold mb-2">Work in progress by stage</h3>
          <div className="flex flex-wrap gap-2">
            {data.wip.map((b) => (
              <span key={b.status} className="text-[11px] px-2.5 py-1 rounded-lg" style={{ background: "var(--panel)" }}>
                <b className="font-mono">{b.count}</b> {b.status}
                {b.oldestDays !== null && <span className="text-[var(--mute)]"> · oldest {b.oldestDays}d</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Topics */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Topics</h2>
      <div className="card mb-4">
        {data.topics.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">
            No active Topics yet. Define them in <Link href="/brand" className="underline">Brand</Link> and tag content —
            then this table shows which ones actually reach publication.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--mute)] text-left">
                  <th className="py-1 pr-3">Topic</th>
                  <th className="py-1 pr-3 text-right">Ideas</th>
                  <th className="py-1 pr-3 text-right">Posts</th>
                  <th className="py-1 pr-3 text-right">Published</th>
                  <th className="py-1 text-right">Publish rate</th>
                </tr>
              </thead>
              <tbody>
                {data.topics.map((t) => (
                  <tr key={t.topicId} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-3">{t.name}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{t.ideas}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{t.posts}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{t.published}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {t.publishRate === null ? (
                        <span className="text-[var(--mute)]">—</span>
                      ) : (
                        <>
                          {t.publishRate}%
                          {t.confidence === "low" && <span className="text-[9px] text-[var(--amber-on)] ml-1">low n</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Distribution */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Distribution &amp; AI use</h2>
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-3 mb-4">
        {distribution.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>

      {/* Performance */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Search &amp; traffic</h2>
      {!hasPerformance && (
        <div className="card mb-3 text-xs flex items-start gap-2" style={{ background: "var(--amber-soft)" }}>
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--amber-on)" }} />
          <span>
            No performance data yet. Connect Search Console and GA4 under{" "}
            <Link href="/admin/analytics" className="underline">Admin → Analytics</Link> and these fill in automatically —
            until then they stay blank rather than showing zeros.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-3 mb-4">
        {performance.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>

      <p className="text-[10px] text-[var(--mute)]">
        Every figure states where it came from. Rates and medians carry a confidence based on how many items produced
        them; counts are exact. Point-in-time values are snapshotted daily so trends survive.
      </p>
    </main>
  );
}
