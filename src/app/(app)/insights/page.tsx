import Link from "next/link";
import { LineChart, TrendingUp, Info, Lightbulb, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { collectWorkspaceMetrics, type Metric, type Confidence } from "@/lib/metrics";
import { readingsForWorkspace, byNetwork } from "@/lib/social/performance";
import { networkFor } from "@/lib/social/networks";
import { openRecommendations, recentlyResolved, parseEvidence } from "@/lib/recommendations";
import { SubmitButton } from "@/components/SubmitButton";
import {
  applyRecommendationAction,
  acceptRecommendationAction,
  dismissRecommendationAction,
  refreshRecommendationsAction,
} from "@/app/actions/recommendations";

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

const SEVERITY_HUE: Record<string, string> = { warning: "rose", opportunity: "amber", info: "blue" };

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const editor = canEdit(membership.role);
  const [data, recs, resolved, socialReadings] = await Promise.all([
    collectWorkspaceMetrics(workspace.id, RANGE_DAYS),
    openRecommendations(workspace.id),
    recentlyResolved(workspace.id),
    readingsForWorkspace(workspace.id, new Date(Date.now() - RANGE_DAYS * 86_400_000)),
  ]);
  const networks = byNetwork(socialReadings);

  const byKey = new Map(data.metrics.map((m) => [m.key, m]));
  const pick = (...keys: string[]) => keys.map((k) => byKey.get(k)).filter((m): m is Metric => Boolean(m));

  const pipeline = pick("posts_published", "idea_approval_rate", "idea_to_draft_rate", "cycle_time_days");
  const momentum = pick("weekly_cadence", "cadence_trend", "wip_open", "wip_stalled");
  const distribution = pick("social_follow_through", "video_follow_through", "ai_generations", "generations_per_publish");
  const performance = pick("search_clicks", "search_impressions", "avg_position", "sessions");
  const social = pick("social_impressions", "social_engagement", "social_engagement_rate", "social_clicks");
  const hasSocial = social.some((m) => m.value !== null);

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

      {data.empty && (
        <div className="card mb-4 text-sm">
          Nothing to measure yet. Capture some ideas and publish a post, and this page fills in on its own —
          <Link href="/ideas" className="underline"> start with Ideas</Link>.
        </div>
      )}

      {/* ── Recommendations ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mt-4 mb-2">
        <h2 className="font-mono text-[13px] font-bold flex-1 flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4" /> Recommendations
          {recs.length > 0 && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
              {recs.length}
            </span>
          )}
        </h2>
        {editor && (
          <form action={refreshRecommendationsAction}>
            <SubmitButton className="btn sm" pendingText="Checking…"><RefreshCw className="w-3.5 h-3.5" /> Re-check</SubmitButton>
          </form>
        )}
      </div>

      {recs.length === 0 ? (
        <div className="card mb-4 text-xs text-[var(--mute)]">
          Nothing to suggest right now. Rules stay silent unless the data clears their threshold — a thin sample
          produces no recommendation rather than a confident guess.
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-4">
          {recs.map((r) => {
            const evidence = parseEvidence(r.evidence);
            const hue = SEVERITY_HUE[r.severity] ?? "blue";
            return (
              <div key={r.id} className="card" style={{ borderLeft: `3px solid var(--${hue})` }}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
                    {r.severity}
                  </span>
                  <h3 className="text-sm font-semibold flex-1 min-w-40">{r.title}</h3>
                  {r.status === "accepted" && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                      accepted
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-[var(--mute)]" title="Confidence is inherited from the weakest metric behind this.">
                    {r.confidence} confidence
                  </span>
                </div>
                <p className="text-xs mb-1.5">{r.detail}</p>
                <p className="text-[11px] text-[var(--mute)] leading-relaxed mb-2">{r.rationale}</p>

                {evidence.length > 0 && (
                  <details className="mb-2">
                    <summary className="cursor-pointer text-[11px] text-[var(--mute)]">Evidence ({evidence.length})</summary>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {evidence.map((e) => (
                        <li key={e.key} className="text-[11px] pl-2" style={{ borderLeft: "2px solid var(--line)" }}>
                          <b className="font-mono">{e.value === null ? "—" : e.value}</b> {e.label}
                          <span className="text-[var(--mute)]"> · n={e.sample} · {e.evidence}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {editor && (
                  <div className="flex flex-wrap items-center gap-2">
                    {r.actionKey && r.status !== "applied" && (
                      <form action={applyRecommendationAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn primary sm" pendingText="Applying…">{r.actionLabel ?? "Apply"}</SubmitButton>
                      </form>
                    )}
                    {r.status === "open" && (
                      <form action={acceptRecommendationAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn sm" pendingText="…">I&apos;ll handle it</SubmitButton>
                      </form>
                    )}
                    <form action={dismissRecommendationAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="reason" placeholder="reason (optional)" className="text-[11px] w-40" />
                      <SubmitButton className="btn sm" pendingText="…">Dismiss</SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="card mb-4">
          <summary className="cursor-pointer text-xs text-[var(--mute)]">Recently resolved ({resolved.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {resolved.map((r) => (
              <li key={r.id} className="text-[11px] flex items-start gap-2">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--zebra)", color: "var(--mute)" }}>
                  {r.status}
                </span>
                <span className="flex-1">
                  {r.title}
                  {r.appliedBy === "auto" && <span className="text-[var(--mute)]"> · applied automatically</span>}
                  {r.dismissedReason && <span className="text-[var(--mute)]"> · “{r.dismissedReason}”</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
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

      {/* Social performance — the distribution side of the same question */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Social performance</h2>
      {!hasSocial && (
        <div className="card mb-3 text-xs flex items-start gap-2" style={{ background: "var(--amber-soft)" }}>
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--amber-on)" }} />
          <span>
            No engagement pulled back yet. Connect a social account under{" "}
            <Link href="/admin/connections" className="underline">Admin → Connections</Link>; once posts have gone out,
            engagement is pulled in automatically and these fill in. Blank means unknown, not zero.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-3 mb-3">
        {social.map((m) => <MetricCard key={m.key} m={m} />)}
      </div>

      {/* Per-network split — the reason UTM tagging separates the sources. */}
      {networks.length > 0 && (
        <div className="card mb-4 overflow-x-auto">
          <h3 className="font-mono text-[11px] font-bold mb-2">By network</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] text-left">
                <th className="pb-1">Network</th>
                <th className="pb-1 text-right">Posts</th>
                <th className="pb-1 text-right">Impressions</th>
                <th className="pb-1 text-right">Engagements</th>
                <th className="pb-1 text-right">Rate</th>
                <th className="pb-1 text-right">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => {
                const net = networkFor(n.provider);
                // A dash is a fact here: the network didn't report it.
                const cell = (v: number | null, suffix = "") =>
                  v === null ? <span className="text-[var(--mute)]">—</span> : `${v.toLocaleString()}${suffix}`;
                return (
                  <tr key={n.provider} className="border-t border-[var(--line)]">
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                        {net?.label ?? n.provider}
                      </span>
                    </td>
                    <td className="text-right font-mono">{n.posts}</td>
                    <td className="text-right font-mono">{cell(n.impressions)}</td>
                    <td className="text-right font-mono">{cell(n.engagement)}</td>
                    <td className="text-right font-mono">{cell(n.engagementRate, "%")}</td>
                    <td className="text-right font-mono">{cell(n.clicks)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-[var(--mute)] mt-2">
            Lifetime totals for posts sent in the last {RANGE_DAYS} days, as last pulled from each network — not
            engagement earned within the window, which a lifetime counter can&apos;t tell us. A dash means the network
            didn&apos;t report that figure.
          </p>
        </div>
      )}

      <p className="text-[10px] text-[var(--mute)]">
        Every figure states where it came from. Rates and medians carry a confidence based on how many items produced
        them; counts are exact. Point-in-time values are snapshotted daily so trends survive.
      </p>
    </main>
  );
}
